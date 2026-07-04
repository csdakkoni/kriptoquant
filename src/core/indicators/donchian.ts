// ============================================================================
// KRIPTOQUANT — Donchian Channel
// ============================================================================
// Richard Donchian'ın kanal indikatörü. Turtle Trading sisteminin temelidir.
// upper[i] = Önceki N mumun en yüksek High'ı (mevcut mum dahil değil)
// lower[i] = Önceki N mumun en düşük Low'u (mevcut mum dahil değil)
// ============================================================================

import type { Candle } from '../types.js';

export interface DonchianResult {
	readonly upper: number[];
	readonly lower: number[];
}

/**
 * Donchian Channel hesaplar.
 * upper[i] ve lower[i], i'den önceki `period` mumun max(high) ve min(low) değerleridir.
 * İlk `period` eleman NaN olur (warmup).
 */
export function donchianChannel(candles: Candle[], period: number): DonchianResult {
	const len = candles.length;
	const upper = new Array(len).fill(NaN) as number[];
	const lower = new Array(len).fill(NaN) as number[];

	for (let i = period; i < len; i++) {
		let maxHigh = -Infinity;
		let minLow = Infinity;

		for (let j = i - period; j < i; j++) {
			if (candles[j].high > maxHigh) maxHigh = candles[j].high;
			if (candles[j].low < minLow) minLow = candles[j].low;
		}

		upper[i] = maxHigh;
		lower[i] = minLow;
	}

	return { upper, lower };
}
