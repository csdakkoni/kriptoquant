// ============================================================================
// KRIPTOQUANT — Volume Weighted Average Price (VWAP)
// ============================================================================
// Hacim ağırlıklı ortalama fiyat indikatörü ve VWAP Z-Score sapması.
// ============================================================================

import type { Candle } from '../types.js';

/**
 * Hacim Ağırlıklı Ortalama Fiyat (VWAP) hesaplar.
 * VWAP = Cumulative(Typical Price * Volume) / Cumulative(Volume)
 * 
 * @param candles - Mum verileri
 * @param period - Rolling pencere periyodu (varsayılan: 20)
 * @returns Her bir mum için VWAP değerlerini içeren dizi
 */
export function vwap(candles: Candle[], period: number = 20): number[] {
	const n = candles.length;
	const vwapValues = new Array<number>(n).fill(NaN);

	for (let i = 0; i < n; i++) {
		if (i < period - 1) {
			continue;
		}

		let sumTypicalPriceVolume = 0;
		let sumVolume = 0;

		for (let j = i - period + 1; j <= i; j++) {
			const c = candles[j];
			const typicalPrice = (c.high + c.low + c.close) / 3;
			sumTypicalPriceVolume += typicalPrice * c.volume;
			sumVolume += c.volume;
		}

		vwapValues[i] = sumVolume > 0 ? sumTypicalPriceVolume / sumVolume : candles[i].close;
	}

	return vwapValues;
}

/**
 * VWAP Z-Score hesaplar.
 * Fiyatın VWAP'tan standart sapma bazında uzaklığını gösterir.
 * Z-Score = (Close - VWAP) / Standard Deviation(Close - VWAP)
 * 
 * @param candles - Mum verileri
 * @param period - Rolling pencere periyodu (varsayılan: 20)
 * @returns Her bir mum için VWAP Z-Score değerlerini içeren dizi
 */
export function vwapZScore(candles: Candle[], period: number = 20): number[] {
	const n = candles.length;
	const vwapValues = vwap(candles, period);
	const zScores = new Array<number>(n).fill(NaN);

	for (let i = 0; i < n; i++) {
		if (i < period - 1 || Number.isNaN(vwapValues[i])) {
			continue;
		}

		// Close ile VWAP farklarının rolling varyans/standart sapmasını hesapla
		let sumSquaredDiffs = 0;
		for (let j = i - period + 1; j <= i; j++) {
			const diff = candles[j].close - vwapValues[i];
			sumSquaredDiffs += diff ** 2;
		}

		const variance = sumSquaredDiffs / period;
		const stdDev = Math.sqrt(variance);

		zScores[i] = stdDev > 0 ? (candles[i].close - vwapValues[i]) / stdDev : 0;
	}

	return zScores;
}
