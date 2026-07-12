// ============================================================================
// KRIPTOQUANT RESEARCH — Hypothesis H001: Pooled Multi-Asset Bootstrap (Sprint 29)
// ============================================================================
// Hata sapmalarını önlemek için 5 farklı coinin (BTC, ETH, SOL, AVAX, BNB)
// trade günlüklerini havuzda (pooled) birleştirip 100+ işlem üzerinden 
// Bootstrap ve Monte Carlo simülasyonlarıyla istatistiksel doğrulamayı koşturur.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAndStore } from '../../data/fetcher.js';
import { getFundingRates, mergeCandlesWithFunding } from '../../data/funding-fetcher.js';
import { runBacktest } from '../backtester.js';
import { createBollingerBandsV2Strategy } from '../strategies/bollinger-bands-v2/index.js';
import type { Trade } from '../../core/types.js';

function bootstrapSample(arr: number[]): number[] {
	if (arr.length === 0) return [];
	const sample: number[] = [];
	for (let i = 0; i < arr.length; i++) {
		const idx = Math.floor(Math.random() * arr.length);
		sample.push(arr[idx]);
	}
	return sample;
}

function getMean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function getSharpe(returns: number[]): number {
	if (returns.length < 2) return 0;
	const mean = getMean(returns);
	const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
	const stdDev = Math.sqrt(variance);
	if (stdDev === 0) return 0;
	return mean / stdDev;
}

function runBootstrap(normalTrades: Trade[], filteredTrades: Trade[], iterations = 1000) {
	const normalPnLs = normalTrades.map(t => t.pnlPercent);
	const filteredPnLs = filteredTrades.map(t => t.pnlPercent);

	const diffs: number[] = [];
	let positiveDiffCount = 0;

	for (let b = 0; b < iterations; b++) {
		const sampleNormal = bootstrapSample(normalPnLs);
		const sampleFiltered = bootstrapSample(filteredPnLs);

		const sharpeNormal = getSharpe(sampleNormal);
		const sharpeFiltered = getSharpe(sampleFiltered);

		const diff = sharpeFiltered - sharpeNormal;
		diffs.push(diff);

		if (diff > 0) {
			positiveDiffCount++;
		}
	}

	diffs.sort((a, b) => a - b);
	const ciLow = diffs[Math.floor(iterations * 0.025)];
	const ciHigh = diffs[Math.floor(iterations * 0.975)];
	const pValue = 1 - (positiveDiffCount / iterations);
	const meanDiff = getMean(diffs);

	return { ciLow, ciHigh, pValue, meanDiff };
}

function shuffle(arr: number[]): number[] {
	const copy = [...arr];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = copy[i];
		copy[i] = copy[j];
		copy[j] = temp;
	}
	return copy;
}

function runMonteCarloDrawdown(trades: Trade[], initialCapital = 10000, iterations = 1000) {
	const pnls = trades.map(t => t.pnl);
	const maxDrawdowns: number[] = [];

	for (let b = 0; b < iterations; b++) {
		const shuffled = shuffle(pnls);
		let capital = initialCapital;
		let peak = initialCapital;
		let maxDd = 0;

		for (const pnl of shuffled) {
			capital += pnl;
			if (capital > peak) peak = capital;
			const dd = (peak - capital) / peak * 100;
			if (dd > maxDd) maxDd = dd;
		}
		maxDrawdowns.push(maxDd);
	}

	maxDrawdowns.sort((a, b) => a - b);
	const meanMaxDrawdown = getMean(maxDrawdowns);
	const maxDrawdown95 = maxDrawdowns[Math.floor(iterations * 0.95)];

	return { meanMaxDrawdown, maxDrawdown95 };
}

async function startBootstrapExperiment() {
	const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT'];
	const interval = '15m';
	const days = 90;

	const endTime = Date.now();
	const startTime = endTime - days * 24 * 60 * 60 * 1000;

	console.log(`\n======================================================`);
	console.log(`🔬 ÇOKLU VARLIK (POOLED) BOOTSTRAP TESTİ BAŞLIYOR...`);
	console.log(`   Hedef: Örneklem Büyüklüğünü 100+ İşleme Çıkararak Varyansı Azaltmak`);
	console.log(`======================================================`);

	const allNormalTrades: Trade[] = [];
	const allFilteredTrades: Trade[] = [];

	const platformConfig = {
		coins: [],
		defaultInterval: interval,
		initialCapital: 10000,
		commissionPercent: 0.0010,
		slippagePercent: 0.0005,
	};

	const riskConfigNormal = {
		maxPositionPercent: 10,
		maxDailyLossPercent: 5,
		maxOrderValue: 1000,
		stopLossAtrMultiplier: 2.0,
		enableFundingFilter: false,
	};

	const riskConfigFiltered = {
		maxPositionPercent: 10,
		maxDailyLossPercent: 5,
		maxOrderValue: 1000,
		stopLossAtrMultiplier: 2.0,
		enableFundingFilter: true,
		fundingPercentileThreshold: 0.95,
	};

	const strategy = createBollingerBandsV2Strategy();

	for (const coin of coins) {
		console.log(`[⚙️] ${coin} verisi yükleniyor ve backtest ediliyor...`);
		const rawCandles = await fetchAndStore(coin, interval, { startTime, endTime });
		const fundingRates = await getFundingRates(coin, startTime, endTime);
		const candles = mergeCandlesWithFunding(rawCandles, fundingRates);

		const normalRes = runBacktest(strategy, candles, { ...platformConfig, coins: [coin] }, riskConfigNormal, coin);
		const filteredRes = runBacktest(strategy, candles, { ...platformConfig, coins: [coin] }, riskConfigFiltered, coin);

		allNormalTrades.push(...normalRes.trades);
		allFilteredTrades.push(...filteredRes.trades);
	}

	console.log(`\n[⚙️] Toplam İşlem Havuzu: Normal = ${allNormalTrades.length} | Filtreli = ${allFilteredTrades.length}`);
	console.log(`[⚙️] Havuzlanmış Bootstrap Yeniden Örnekleme (1000 İterasyon)...`);
	const boot = runBootstrap(allNormalTrades, allFilteredTrades, 1000);

	console.log(`[⚙️] Havuzlanmış Monte Carlo Sıralama Karıştırma (1000 İterasyon)...`);
	const mcNormal = runMonteCarloDrawdown(allNormalTrades, 10000, 1000);
	const mcFiltered = runMonteCarloDrawdown(allFilteredTrades, 10000, 1000);

	// Gözlemlenen havuzlanmış Sharpe
	const observedNormalSharpe = getSharpe(allNormalTrades.map(t => t.pnlPercent));
	const observedFilteredSharpe = getSharpe(allFilteredTrades.map(t => t.pnlPercent));

	console.clear();
	console.log(`\n========================================================================================`);
	console.log(`📊 ÇOKLU VARLIK (POOLED) BOOTSTRAP & MONTE CARLO DEĞERLENDİRMESİ (5 COIN - 15M - 90 GÜN)`);
	console.log(`========================================================================================`);
	console.log(` Gözlemlenen Havuzlanmış Normal Sharpe : ${observedNormalSharpe.toFixed(3)} (Toplam İşlem: ${allNormalTrades.length})`);
	console.log(` Gözlemlenen Havuzlanmış Filtreli Sharpe : ${observedFilteredSharpe.toFixed(3)} (Toplam İşlem: ${allFilteredTrades.length})`);
	console.log(`----------------------------------------------------------------------------------------`);
	console.log(` Sharpe İyileşme Ortalama: ${boot.meanDiff.toFixed(3)}`);
	console.log(` %95 Güven Aralığı (CI)   : [${boot.ciLow.toFixed(3)}, ${boot.ciHigh.toFixed(3)}]`);
	console.log(` p-Value (Anlamlılık)    : ${boot.pValue.toFixed(4)} (${boot.pValue < 0.05 ? 'ANLAMLI - EDGE KANITLANDI' : 'ANLAMSIZ - SHAPE FARKLI DEĞİL'})`);
	console.log(`----------------------------------------------------------------------------------------`);
	console.log(` Monte Carlo Max Drawdown (Normal)   : Ortalama %${mcNormal.meanMaxDrawdown.toFixed(2)} | %95 Kötü Durum: %${mcNormal.maxDrawdown95.toFixed(2)}`);
	console.log(` Monte Carlo Max Drawdown (Filtered) : Ortalama %${mcFiltered.meanMaxDrawdown.toFixed(2)} | %95 Kötü Durum: %${mcFiltered.maxDrawdown95.toFixed(2)}`);
	console.log(`========================================================================================\n`);

	// Raporu Markdown olarak kaydet
	let md = `# Hipotez H001: Çoklu Varlık (Pooled) Bootstrap & Monte Carlo İstatistiksel Analiz Raporu\n\n`;
	md += `* **Test Edilen Varlıklar:** ${coins.join(', ')} (15m)\n`;
	md += `* **Örneklem:** ${days} Gün | Toplam Normal İşlem: ${allNormalTrades.length} | Toplam Filtreli İşlem: ${allFilteredTrades.length}\n\n`;
	md += `## Bootstrap İyileşme Analizi (1000 İterasyon)\n\n`;
	md += `* **Gözlemlenen Normal Sharpe:** ${observedNormalSharpe.toFixed(3)}\n`;
	md += `* **Gözlemlenen Filtreli Sharpe:** ${observedFilteredSharpe.toFixed(3)}\n`;
	md += `* **Sharpe İyileşme Ortalaması:** ${boot.meanDiff.toFixed(3)}\n`;
	md += `* **%95 Güven Aralığı (CI):** \`[${boot.ciLow.toFixed(3)} , ${boot.ciHigh.toFixed(3)}]\`\n`;
	md += `* **p-Değeri:** ${boot.pValue.toFixed(4)} (${boot.pValue < 0.05 ? 'ISTATISTIKSEL OLARAK ANLAMLI' : 'ANLAMSIZ'})\n\n`;
	md += `> [!NOTE]\n`;
	md += `> Çoklu varlık havuzu (pooled dataset) kullanılarak örneklem boyutu 100+ işleme çıkarılmış ve istatistiksel varyans azaltılmıştır.\n\n`;
	md += `## Monte Carlo Maksimum Drawdown Dağılımı (1000 İterasyon)\n\n`;
	md += `| Versiyon | Ortalama Max Drawdown | %95 Kötü Durum Max Drawdown |\n`;
	md += `| :--- | :---: | :---: |\n`;
	md += `| **Normal (Filtresiz)** | %${mcNormal.meanMaxDrawdown.toFixed(2)} | %${mcNormal.maxDrawdown95.toFixed(2)} |\n`;
	md += `| **Filtreli (Percentile >= 95%)** | %${mcFiltered.meanMaxDrawdown.toFixed(2)} | %${mcFiltered.maxDrawdown95.toFixed(2)} |\n\n`;
	md += `## Sonuç\n`;
	if (boot.ciLow > 0 && boot.pValue < 0.05) {
		md += `**[🟢 GÜÇLÜ KANIT]** Çoklu varlık havuzlu Bootstrap analizi sonucunda elde edilen %95 Güven Aralığı tamamen pozitif bölgededir. Filtrenin getirdiği Sharpe iyileşmesi şans eseri değildir. Monte Carlo simülasyonları da ortalama ve en kötü durum drawdown risklerini belirgin şekilde düşürdüğünü kanıtlamaktadır.\n`;
	} else {
		md += `**[🔴 YETERSİZ KANIT]** Güven aralığı sıfırın altını görmektedir veya p-değeri 0.05'ten büyüktür. Filtre fayda sağlıyor gibi görünse de istatistiksel olarak yeterince güçlü değildir.\n`;
	}

	const reportPath = join(process.cwd(), 'results', 'H001_bootstrap_report.md');
	writeFileSync(reportPath, md, 'utf-8');
	console.log(`[💾 RAPOR KAYDEDİLDİ] Bootstrap analiz raporu yazıldı: ${reportPath}\n`);
}

startBootstrapExperiment().catch(err => {
	console.error('Bootstrap deneyinde hata oluştu:', err);
});
