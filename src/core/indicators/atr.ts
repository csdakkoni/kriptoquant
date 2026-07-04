// ============================================================================
// KRIPTOQUANT — Average True Range (ATR)
// ============================================================================
// Volatilite ölçüsü. Wilder's smoothing kullanır.
// Sistemin resmi volatilite göstergesi — stop-loss ve risk hesaplamalarında kullanılır.
// ============================================================================

import type { Candle } from '../types.js';

/**
 * True Range hesaplar.
 *
 * True Range = max(
 *   high - low,
 *   |high - previousClose|,
 *   |low - previousClose|
 * )
 *
 * @param candles - Mum verileri (en az 2 eleman)
 * @returns True Range değerleri. İlk eleman (indeks 0) NaN döner
 *          çünkü önceki mumun kapanışı yoktur.
 */
export function trueRange(candles: Candle[]): number[] {
	if (candles.length < 2) throw new Error(`True Range needs at least 2 candles, got ${candles.length}`);

	const result: number[] = new Array(candles.length);
	result[0] = NaN; // Önceki mum yok

	for (let i = 1; i < candles.length; i++) {
		const high = candles[i].high;
		const low = candles[i].low;
		const prevClose = candles[i - 1].close;

		result[i] = Math.max(
			high - low,
			Math.abs(high - prevClose),
			Math.abs(low - prevClose),
		);
	}

	return result;
}

/**
 * Average True Range (ATR) hesaplar.
 *
 * Wilder's smoothing kullanır (RSI ile aynı yöntem):
 * - İlk ATR = TR'lerin basit ortalaması (ilk `period` adet TR)
 * - Sonrakiler: ATR = (prevATR × (period-1) + currentTR) / period
 *
 * @param candles - Mum verileri
 * @param period - ATR periyodu (standart: 14)
 * @returns ATR değerleri. İlk `period` eleman NaN.
 */
export function atr(candles: Candle[], period: number = 14): number[] {
	if (period <= 0) throw new Error(`ATR period must be positive, got ${period}`);
	if (candles.length < period + 1) {
		throw new Error(`ATR needs at least ${period + 1} candles, got ${candles.length}`);
	}

	const tr = trueRange(candles);
	const result: number[] = new Array(candles.length);

	// İlk `period` eleman NaN
	for (let i = 0; i <= period; i++) {
		result[i] = NaN;
	}

	// İlk ATR = ilk `period` adet geçerli TR'nin basit ortalaması
	// TR[0] NaN olduğu için TR[1]..TR[period] kullanılır
	let sum = 0;
	for (let i = 1; i <= period; i++) {
		sum += tr[i];
	}
	result[period] = sum / period;

	// Wilder's smoothing
	for (let i = period + 1; i < candles.length; i++) {
		result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
	}

	return result;
}
