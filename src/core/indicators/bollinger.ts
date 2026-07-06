// ============================================================================
// KRIPTOQUANT — Bollinger Bands
// ============================================================================
// Fiyat kanallarını standart sapma bazında hesaplar.
// ============================================================================

import { mean, standardDeviation } from '../utils.js';

export interface BollingerResult {
	readonly middle: number[];
	readonly upper: number[];
	readonly lower: number[];
}

/**
 * Bollinger Bantlarını hesaplar.
 * Middle Band = SMA(Close, period)
 * Upper Band = Middle Band + (multiplier * Standard Deviation(Close, period))
 * Lower Band = Middle Band - (multiplier * Standard Deviation(Close, period))
 * 
 * @param closes - Kapanış fiyatları dizisi
 * @param period - Rolling pencere periyodu (varsayılan: 20)
 * @param multiplier - Standart sapma çarpanı (varsayılan: 2)
 * @returns BollingerResult (middle, upper, lower dizileri)
 */
export function bollingerBands(closes: number[], period: number = 20, multiplier: number = 2): BollingerResult {
	const n = closes.length;
	const middle = new Array<number>(n).fill(NaN);
	const upper = new Array<number>(n).fill(NaN);
	const lower = new Array<number>(n).fill(NaN);

	for (let i = 0; i < n; i++) {
		if (i < period - 1) {
			continue;
		}

		const window = closes.slice(i - period + 1, i + 1);
		const avg = mean(window);
		const std = standardDeviation(window);

		middle[i] = avg;
		upper[i] = avg + multiplier * std;
		lower[i] = avg - multiplier * std;
	}

	return { middle, upper, lower };
}
