// ============================================================================
// KRIPTOQUANT — Signal Analyzer
// ============================================================================
// Her ham sinyalin neden kabul veya reddedildiğini tam ölçülebilir hale getirir.
// Filter Engine + Confidence Engine çıktılarını tek bir kayıtta birleştirir.
// Çıktısı: AnalyzedSignal[] — backtester, rapor ve CSV export bunu kullanır.
// ============================================================================

import type { Candle, Signal, FilterConfig, ConfidenceConfig } from '../../core/types.js';
import { formatDate } from '../../core/utils.js';
import { createFilterEngine } from '../filters/filter-engine.js';
import { calculateConfidence } from '../confidence/confidence-engine.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface AnalyzedSignal {
	readonly symbol: string;
	readonly timestamp: number;
	readonly date: string;
	readonly strategy: string;
	readonly direction: 'BUY' | 'SELL';
	readonly price: number;
	readonly indicatorFast: number;
	readonly indicatorSlow: number;
	readonly adx: number;
	readonly rvol: number;
	readonly confidenceScore: number;
	readonly accepted: boolean;
	readonly rejectReasons: string[];
}

export interface FilterStats {
	readonly totalSignals: number;
	readonly accepted: number;
	readonly rejected: number;
	readonly acceptanceRate: number; // Yüzde
	readonly byFilter: {
		readonly adx: number;
		readonly rvol: number;
		readonly confidence: number;
		readonly multiple: number;
	};
}

// ─── Signal Analyzer ─────────────────────────────────────────────────────────

/**
 * Ham sinyalleri analiz eder. Her sinyal için Filter + Confidence pipeline çalıştırır.
 *
 * @param signals - Stratejiden gelen ham sinyaller
 * @param candles - Backtest mum verileri
 * @param strategyName - Strateji adı
 * @param symbol - Coin sembolü
 * @param filterConfig - Filtre eşikleri
 * @param confidenceConfig - Güven motoru eşikleri
 */
export function analyzeSignals(
	signals: Signal[],
	candles: Candle[],
	strategyName: string,
	symbol: string,
	filterConfig: FilterConfig,
	confidenceConfig: ConfidenceConfig,
): AnalyzedSignal[] {
	const filterEngine = createFilterEngine(candles, filterConfig);

	// Timestamp → candle index map
	const timestampToIndex = new Map<number, number>();
	for (let i = 0; i < candles.length; i++) {
		timestampToIndex.set(candles[i].openTime, i);
	}

	return signals.map((signal) => {
		const candleIndex = timestampToIndex.get(signal.timestamp) ?? -1;
		const filterVerdict = candleIndex >= 0
			? filterEngine.evaluate(candleIndex)
			: { passed: false, reasons: ['Unknown candle index'], adx: 0, rvol: 0 };

		let accepted = filterVerdict.passed;
		const rejectReasons = [...filterVerdict.reasons];

		// Confidence sadece filtreler geçtiyse hesaplanır
		let confidenceScore = 0;
		if (filterVerdict.passed) {
			const confidenceVerdict = calculateConfidence(
				filterVerdict.adx, filterVerdict.rvol, confidenceConfig,
			);
			confidenceScore = confidenceVerdict.score;
			if (!confidenceVerdict.passed) {
				accepted = false;
				rejectReasons.push(`Insufficient Score (${confidenceVerdict.score}/${confidenceConfig.minimumScore})`);
			}
		}

		return {
			symbol,
			timestamp: signal.timestamp,
			date: formatDate(signal.timestamp),
			strategy: strategyName,
			direction: signal.side,
			price: signal.price,
			indicatorFast: signal.metadata?.indicatorFast ?? 0,
			indicatorSlow: signal.metadata?.indicatorSlow ?? 0,
			adx: filterVerdict.adx,
			rvol: filterVerdict.rvol,
			confidenceScore,
			accepted,
			rejectReasons,
		};
	});
}

// ─── Filter Statistics ───────────────────────────────────────────────────────

/**
 * Analiz edilmiş sinyallerden filtre istatistikleri çıkarır.
 */
export function calculateFilterStats(analyzed: AnalyzedSignal[]): FilterStats {
	const accepted = analyzed.filter((s) => s.accepted).length;
	const rejected = analyzed.filter((s) => !s.accepted).length;

	let adxOnly = 0;
	let rvolOnly = 0;
	let confidenceOnly = 0;
	let multiple = 0;

	for (const s of analyzed) {
		if (s.accepted) continue;

		const hasAdx = s.rejectReasons.some((r) => r.startsWith('Weak Trend'));
		const hasRvol = s.rejectReasons.some((r) => r.startsWith('Low Volume'));
		const hasConf = s.rejectReasons.some((r) => r.startsWith('Insufficient Score'));
		const filterCount = [hasAdx, hasRvol, hasConf].filter(Boolean).length;

		if (filterCount > 1) {
			multiple++;
		} else if (hasAdx) {
			adxOnly++;
		} else if (hasRvol) {
			rvolOnly++;
		} else if (hasConf) {
			confidenceOnly++;
		}
	}

	return {
		totalSignals: analyzed.length,
		accepted,
		rejected,
		acceptanceRate: analyzed.length > 0 ? (accepted / analyzed.length) * 100 : 0,
		byFilter: {
			adx: adxOnly,
			rvol: rvolOnly,
			confidence: confidenceOnly,
			multiple,
		},
	};
}

// ─── Signal Journal CSV ──────────────────────────────────────────────────────

/**
 * Tüm analiz edilmiş sinyalleri CSV dosyasına yazar.
 * Trade olsun olmasın her crossover kaydedilir.
 */
export function exportSignalJournal(analyzed: AnalyzedSignal[], filepath: string): void {
	mkdirSync(dirname(filepath), { recursive: true });

	const header = 'Timestamp,Strategy,Direction,Price,Indicator Fast,Indicator Slow,ADX,RVOL,Confidence,Accepted,Reject Reasons';
	const rows = analyzed.map((s) =>
		[
			s.date,
			s.strategy,
			s.direction,
			s.price.toFixed(2),
			s.indicatorFast.toFixed(2),
			s.indicatorSlow.toFixed(2),
			s.adx.toFixed(1),
			s.rvol.toFixed(2),
			s.confidenceScore.toString(),
			s.accepted ? 'YES' : 'NO',
			s.rejectReasons.length > 0 ? `"${s.rejectReasons.join(' | ')}"` : '',
		].join(','),
	);

	writeFileSync(filepath, [header, ...rows].join('\n'), 'utf-8');
}
