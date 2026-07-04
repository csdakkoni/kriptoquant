// ============================================================================
// KRIPTOQUANT — MACD (Moving Average Convergence Divergence)
// ============================================================================
// EMA tabanlı MACD hesaplaması. Saf fonksiyon.
// ============================================================================

/**
 * Exponential Moving Average hesaplar (MACD'nin iç bileşeni).
 *
 * @param values - Değer dizisi
 * @param period - EMA periyodu
 * @returns EMA değerleri dizisi. İlk (period - 1) eleman NaN.
 */
export function ema(values: number[], period: number): number[] {
	if (period <= 0) throw new Error(`EMA period must be positive, got ${period}`);
	if (period > values.length) throw new Error(`EMA period (${period}) exceeds data length (${values.length})`);

	const result: number[] = new Array(values.length);
	const multiplier = 2 / (period + 1);

	// İlk (period - 1) eleman hesaplanamaz
	for (let i = 0; i < period - 1; i++) {
		result[i] = NaN;
	}

	// İlk EMA değeri = basit ortalama (SMA)
	let sum = 0;
	for (let i = 0; i < period; i++) {
		sum += values[i];
	}
	result[period - 1] = sum / period;

	// Sonraki değerler: EMA formülü
	for (let i = period; i < values.length; i++) {
		result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
	}

	return result;
}

/**
 * MACD hesaplamasının sonucu.
 */
export interface MACDResult {
	readonly macdLine: number[]; // MACD çizgisi (fast EMA - slow EMA)
	readonly signalLine: number[]; // Sinyal çizgisi (MACD'nin EMA'sı)
	readonly histogram: number[]; // Histogram (MACD - Signal)
}

/**
 * MACD (Moving Average Convergence Divergence) hesaplar.
 *
 * Standart parametreler: fast=12, slow=26, signal=9
 *
 * @param values - Kapanış fiyatları dizisi
 * @param fastPeriod - Hızlı EMA periyodu (varsayılan: 12)
 * @param slowPeriod - Yavaş EMA periyodu (varsayılan: 26)
 * @param signalPeriod - Sinyal çizgisi EMA periyodu (varsayılan: 9)
 * @returns MACD çizgisi, sinyal çizgisi ve histogram
 */
export function macd(
	values: number[],
	fastPeriod: number = 12,
	slowPeriod: number = 26,
	signalPeriod: number = 9,
): MACDResult {
	if (fastPeriod >= slowPeriod) {
		throw new Error(`Fast period (${fastPeriod}) must be less than slow period (${slowPeriod})`);
	}

	const fastEma = ema(values, fastPeriod);
	const slowEma = ema(values, slowPeriod);

	// MACD Line = Fast EMA - Slow EMA
	const macdLine: number[] = new Array(values.length);
	for (let i = 0; i < values.length; i++) {
		macdLine[i] = Number.isNaN(fastEma[i]) || Number.isNaN(slowEma[i])
			? NaN
			: fastEma[i] - slowEma[i];
	}

	// MACD çizgisindeki NaN olmayan değerleri bul
	const validMacdValues: number[] = [];
	const validMacdStartIndex = macdLine.findIndex((v) => !Number.isNaN(v));

	if (validMacdStartIndex === -1) {
		return {
			macdLine,
			signalLine: new Array(values.length).fill(NaN),
			histogram: new Array(values.length).fill(NaN),
		};
	}

	for (let i = validMacdStartIndex; i < values.length; i++) {
		validMacdValues.push(macdLine[i]);
	}

	// Signal Line = MACD çizgisinin EMA'sı
	const signalEma = ema(validMacdValues, signalPeriod);
	const signalLine: number[] = new Array(values.length).fill(NaN);
	for (let i = 0; i < signalEma.length; i++) {
		signalLine[validMacdStartIndex + i] = signalEma[i];
	}

	// Histogram = MACD Line - Signal Line
	const histogram: number[] = new Array(values.length);
	for (let i = 0; i < values.length; i++) {
		histogram[i] = Number.isNaN(macdLine[i]) || Number.isNaN(signalLine[i])
			? NaN
			: macdLine[i] - signalLine[i];
	}

	return { macdLine, signalLine, histogram };
}
