// ============================================================================
// KRIPTOQUANT — Relative Strength Index (RSI)
// ============================================================================
// Wilder's Smoothing Method (Exponential Moving Average) kullanır.
// Saf fonksiyon: number[] alır, number[] döner.
// ============================================================================

/**
 * Relative Strength Index (RSI) hesaplar.
 *
 * Wilder'ın orijinal formülünü kullanır:
 * 1. Fiyat değişimlerini hesapla (change = close[i] - close[i-1])
 * 2. Pozitif değişimlerin ortalaması (avgGain) ve negatif değişimlerin ortalaması (avgLoss)
 * 3. RS = avgGain / avgLoss
 * 4. RSI = 100 - (100 / (1 + RS))
 *
 * @param values - Kapanış fiyatları dizisi
 * @param period - RSI periyodu (standart: 14)
 * @returns RSI değerleri dizisi (0–100 aralığında). İlk `period` eleman NaN.
 *
 * @example
 * rsi([44, 44.34, 44.09, ...], 14) → [NaN, ..., 70.53, ...]
 */
export function rsi(values: number[], period: number = 14): number[] {
	if (period <= 0) throw new Error(`RSI period must be positive, got ${period}`);
	if (values.length < period + 1) {
		throw new Error(`RSI needs at least ${period + 1} data points, got ${values.length}`);
	}

	const result: number[] = new Array(values.length);

	// İlk `period` eleman hesaplanamaz
	for (let i = 0; i <= period; i++) {
		result[i] = NaN;
	}

	// İlk ortalama kazanç ve kayıp: basit ortalama ile başla
	let avgGain = 0;
	let avgLoss = 0;
	for (let i = 1; i <= period; i++) {
		const change = values[i] - values[i - 1];
		if (change > 0) avgGain += change;
		else avgLoss += Math.abs(change);
	}
	avgGain /= period;
	avgLoss /= period;

	// İlk RSI değeri
	result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

	// Wilder's smoothing: sonraki değerler için exponential ortalama
	for (let i = period + 1; i < values.length; i++) {
		const change = values[i] - values[i - 1];
		const gain = change > 0 ? change : 0;
		const loss = change < 0 ? Math.abs(change) : 0;

		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;

		result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
	}

	return result;
}
