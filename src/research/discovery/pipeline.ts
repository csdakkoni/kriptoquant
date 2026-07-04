// ============================================================================
// KRIPTOQUANT — Alpha Discovery Pipeline & Orchestrator (Sprint 19)
// ============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { generateCandidates } from './generator.js';
import { DiscoveryWorker } from './worker.js';
import { calculateParetoFront } from './pareto.js';
import type { DiscoveryReport, CandidateResult } from './types.js';
import { CSVProvider } from '../../data/csv-provider.js';
import { log, logError } from '../../core/utils.js';

/**
 * Çok aşamalı Alpha Keşif boru hattını (Discovery Pipeline) çalıştırır.
 *
 * @param coins - Test edilecek varlıklar listesi (ör. ["BTCUSDT", "ETHUSDT"])
 * @param candidateCount - Üretilecek aday strateji sayısı
 * @param interval - Zaman aralığı (varsayılan: "1d")
 */
export async function runDiscoveryPipeline(
	coins: string[],
	candidateCount: number,
	interval: string = '1d',
): Promise<DiscoveryReport> {
	log(`Alpha Keşif Süreci Başlıyor... Aday Sayısı: ${candidateCount} | Varlıklar: ${coins.join(', ')}`);

	// 1) Tarihsel verileri yükle
	const provider = new CSVProvider();
	const candlesMap = new Map();
	for (const coin of coins) {
		const candles = await provider.getHistory(coin, interval);
		if (candles.length === 0) {
			throw new Error(`${coin} için tarihsel veri bulunamadı!`);
		}
		candlesMap.set(coin, candles);
	}

	// 2) Adayları üret
	const candidates = generateCandidates(candidateCount);

	// 3) Worker'ı ilklendir
	const worker = new DiscoveryWorker(coins, interval, candlesMap);
	const results: CandidateResult[] = [];

	// 4) Adayları sırayla kontrol noktalarından geçir
	let passedCount = 0;
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		log(`  [${i + 1}/${candidateCount}] Aday test ediliyor: ${candidate.metadata.name}...`);

		const res = await worker.evaluate(candidate);
		results.push(res);

		if (res.stage === 'PASSED') {
			passedCount++;
			log(`    ✔ GEÇTİ! Bitiş Bakiyesi: ${res.totalReturn}% | Sharpe: ${res.sharpeRatio} | Skor: ${res.score?.overall}`);
		} else {
			log(`    ✖ Elendi. Aşama: ${res.stage} | Neden: ${res.failureReason}`);
		}
	}

	// 5) Pareto Front optimal adayları filtrele
	const paretoFront = calculateParetoFront(results);

	const report: DiscoveryReport = {
		timestamp: new Date().toISOString(),
		coins,
		totalCandidates: candidateCount,
		passedCandidates: passedCount,
		results,
		paretoFront,
	};

	// 6) Sonuçları Kalıcı Kayıt Defterine (Registry) Kaydet
	saveDiscoveryToRegistry(report);

	// 7) En iyi adayları / Pareto optimal stratejileri dışa aktar
	saveTopCandidateConfigs(results);

	return report;
}

/**
 * Keşif sonuçlarını results/alpha_discovery_registry.json dosyasına ekler.
 */
function saveDiscoveryToRegistry(report: DiscoveryReport): void {
	const registryPath = 'results/alpha_discovery_registry.json';
	let registry: DiscoveryReport[] = [];

	try {
		// results klasörü var mı kontrol et
		if (!existsSync('results')) {
			mkdirSync('results');
		}

		if (existsSync(registryPath)) {
			const raw = readFileSync(registryPath, 'utf-8');
			registry = JSON.parse(raw) as DiscoveryReport[];
		}
	} catch (err) {
		logError(`Registry yüklenirken hata oluştu, sıfırdan oluşturuluyor: ${err instanceof Error ? err.message : String(err)}`);
	}

	registry.push(report);

	try {
		writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
		log(`  💾 Tüm keşif geçmişi kaydedildi: ${registryPath}`);
	} catch (err) {
		logError(`Registry yazılırken hata oluştu: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * En başarılı adayın (overall skoru en yüksek) JSON konfigürasyonunu kaydeder.
 */
function saveTopCandidateConfigs(results: CandidateResult[]): void {
	const passed = results.filter((r) => r.stage === 'PASSED');
	if (passed.length === 0) return;

	// En yüksek skora göre sırala
	const sorted = [...passed].sort((a, b) => (b.score?.overall ?? 0) - (a.score?.overall ?? 0));
	const top = sorted[0];

	try {
		if (!existsSync('results/alpha')) {
			mkdirSync('results/alpha', { recursive: true });
		}
		const path = `results/alpha/top_candidate_${top.config.metadata.name}.json`;
		writeFileSync(path, JSON.stringify(top.config, null, 2), 'utf-8');
		log(`  🏆 En başarılı aday strateji kaydedildi: ${path}`);
	} catch (err) {
		logError(`En iyi aday konfigürasyonu kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`);
	}
}
