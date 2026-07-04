// ============================================================================
// KRIPTOQUANT — Simple Moving Average (SMA)
// ============================================================================
// Saf fonksiyon: number[] alır, number[] döner. Yan etkisi yoktur.
// ============================================================================

/**
 * Simple Moving Average hesaplar.
 *
 * @param values - Kapanış fiyatları dizisi
 * @param period - SMA periyodu (ör. 20)
 * @returns SMA değerleri dizisi. İlk (period - 1) eleman NaN olarak döner
 *          çünkü hesaplama için yeterli veri yoktur.
 *
 * @example
 * sma([1, 2, 3, 4, 5], 3) → [NaN, NaN, 2, 3, 4]
 */
export function sma(values: number[], period: number): number[] {
	if (period <= 0) throw new Error(`SMA period must be positive, got ${period}`);
	if (period > values.length) throw new Error(`SMA period (${period}) exceeds data length (${values.length})`);

	const result: number[] = new Array(values.length);

	// İlk (period - 1) eleman hesaplanamaz
	for (let i = 0; i < period - 1; i++) {
		result[i] = NaN;
	}

	// İlk pencere toplamını hesapla
	let windowSum = 0;
	for (let i = 0; i < period; i++) {
		windowSum += values[i];
	}
	result[period - 1] = windowSum / period;

	// Kayan pencere: bir eleman ekle, bir eleman çıkar
	for (let i = period; i < values.length; i++) {
		windowSum += values[i] - values[i - period];
		result[i] = windowSum / period;
	}

	return result;
}
