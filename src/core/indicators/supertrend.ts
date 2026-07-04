// ============================================================================
// KRIPTOQUANT — Supertrend Indicator (Sprint 16)
// ============================================================================
// Welles Wilder'ın ATR'sine dayanan trend takip indikatörü.
// BUY: Fiyat Supertrend çizgisini yukarı kırdığında (direction = 1)
// SELL: Fiyat Supertrend çizgisini aşağı kırdığında (direction = -1)
// ============================================================================

import type { Candle } from '../types.js';
import { atr } from './atr.js';

export interface SupertrendResult {
	readonly supertrend: number[];
	readonly direction: number[]; // 1 = Bullish, -1 = Bearish
}

/**
 * Supertrend hesaplar.
 *
 * @param candles - Mum serisi
 * @param period - ATR periyodu (varsayılan: 10)
 * @param multiplier - ATR çarpanı (varsayılan: 3.0)
 */
export function supertrend(
	candles: Candle[],
	period: number = 10,
	multiplier: number = 3.0,
): SupertrendResult {
	const length = candles.length;
	const supertrendLine: number[] = new Array(length).fill(NaN);
	const direction: number[] = new Array(length).fill(1); // Varsayılan 1

	if (length < period + 1) {
		return { supertrend: supertrendLine, direction };
	}

	const atrValues = atr(candles, period);

	const finalUpperBand: number[] = new Array(length).fill(NaN);
	const finalLowerBand: number[] = new Array(length).fill(NaN);

	// İlk değerleri set et
	for (let i = 0; i < length; i++) {
		const c = candles[i];
		const atrVal = atrValues[i];

		if (Number.isNaN(atrVal)) {
			continue;
		}

		const hl2 = (c.high + c.low) / 2;
		const basicUpper = hl2 + multiplier * atrVal;
		const basicLower = hl2 - multiplier * atrVal;

		if (i === 0 || Number.isNaN(finalUpperBand[i - 1])) {
			finalUpperBand[i] = basicUpper;
			finalLowerBand[i] = basicLower;
			supertrendLine[i] = basicLower; // Başlangıç varsayımı
			direction[i] = 1;
			continue;
		}

		const prevClose = candles[i - 1].close;
		const prevFinalUpper = finalUpperBand[i - 1];
		const prevFinalLower = finalLowerBand[i - 1];

		// Final Band Hesaplamaları
		finalUpperBand[i] = (basicUpper < prevFinalUpper || prevClose > prevFinalUpper)
			? basicUpper
			: prevFinalUpper;

		finalLowerBand[i] = (basicLower > prevFinalLower || prevClose < prevFinalLower)
			? basicLower
			: prevFinalLower;

		// Direction (Yön) ve Supertrend Belirleme
		const prevDirection = direction[i - 1];
		let currDirection = prevDirection;

		if (prevDirection === 1 && c.close < finalLowerBand[i]) {
			currDirection = -1;
		} else if (prevDirection === -1 && c.close > finalUpperBand[i]) {
			currDirection = 1;
		}

		direction[i] = currDirection;
		supertrendLine[i] = currDirection === 1 ? finalLowerBand[i] : finalUpperBand[i];
	}

	return {
		supertrend: supertrendLine,
		direction,
	};
}
