// ============================================================================
// KRIPTOQUANT — Data Splitter (Sprint 9)
// ============================================================================
// Candle verisini kronolojik olarak Train/Test'e böler.
// Shuffle yok. Gelecek geçmişe karışmaz. Zaman bazlı split.
// ============================================================================

import type { Candle } from '../../core/types.js';
import { formatDate } from '../../core/utils.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface TimePeriod {
	readonly start: string;
	readonly end: string;
	readonly startTs: number;
	readonly endTs: number;
	readonly candleCount: number;
}

export interface SplitResult {
	readonly train: Candle[];
	readonly test: Candle[];
	readonly trainPeriod: TimePeriod;
	readonly testPeriod: TimePeriod;
}

// ─── Splitter ────────────────────────────────────────────────────────────────

/**
 * Candle dizisini kronolojik olarak Train ve Test setlerine böler.
 *
 * - Hiçbir shuffle yapılmaz.
 * - Gelecek veri geçmiş veriye karışmaz (future leak koruması).
 * - Train seti daima Test setinden önce gelir.
 *
 * @param candles - Zaman sıralı mum verisi
 * @param trainRatio - Train oranı (0-1 arası, varsayılan 0.70)
 */
export function splitData(candles: Candle[], trainRatio: number = 0.70): SplitResult {
	if (candles.length < 10) {
		throw new Error(`Veri çok kısa: ${candles.length} mum (minimum 10)`);
	}

	if (trainRatio <= 0 || trainRatio >= 1) {
		throw new Error(`trainRatio 0-1 arasında olmalı: ${trainRatio}`);
	}

	const splitIndex = Math.floor(candles.length * trainRatio);

	const train = candles.slice(0, splitIndex);
	const test = candles.slice(splitIndex);

	return {
		train,
		test,
		trainPeriod: {
			start: formatDate(train[0].openTime),
			end: formatDate(train[train.length - 1].openTime),
			startTs: train[0].openTime,
			endTs: train[train.length - 1].openTime,
			candleCount: train.length,
		},
		testPeriod: {
			start: formatDate(test[0].openTime),
			end: formatDate(test[test.length - 1].openTime),
			startTs: test[0].openTime,
			endTs: test[test.length - 1].openTime,
			candleCount: test.length,
		},
	};
}
