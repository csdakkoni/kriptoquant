// ============================================================================
// KRIPTOQUANT — Utility Functions
// ============================================================================
// Küçük, saf yardımcı fonksiyonlar. Her biri tek bir iş yapar.
// ============================================================================

/**
 * Sayıyı belirtilen ondalık basamağa yuvarlar.
 */
export function round(value: number, decimals: number = 2): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

/**
 * Unix timestamp'i (ms) okunabilir ISO tarih formatına dönüştürür.
 */
export function formatDate(timestampMs: number): string {
	return new Date(timestampMs).toISOString().slice(0, 10);
}

/**
 * Unix timestamp'i (ms) okunabilir tarih-saat formatına dönüştürür.
 */
export function formatDateTime(timestampMs: number): string {
	return new Date(timestampMs).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Yüzde değerini formatlar.
 */
export function formatPercent(value: number): string {
	return `${value >= 0 ? '+' : ''}${round(value, 2)}%`;
}

/**
 * USDT değerini formatlar.
 */
export function formatUSDT(value: number): string {
	return `${round(value, 2)} USDT`;
}

/**
 * Konsola zaman damgalı log yazar.
 */
export function log(message: string): void {
	const timestamp = new Date().toISOString().slice(11, 19);
	console.log(`[${timestamp}] ${message}`);
}

/**
 * Konsola zaman damgalı hata yazar.
 */
export function logError(message: string): void {
	const timestamp = new Date().toISOString().slice(11, 19);
	console.error(`[${timestamp}] ❌ ${message}`);
}

/**
 * Belirtilen milisaniye kadar bekler.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bir dizi sayının ortalamasını hesaplar.
 */
export function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Bir dizi sayının standart sapmasını hesaplar.
 */
export function standardDeviation(values: number[]): number {
	if (values.length < 2) return 0;
	const avg = mean(values);
	const squaredDiffs = values.map((v) => (v - avg) ** 2);
	return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1));
}
