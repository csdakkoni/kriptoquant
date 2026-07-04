// ============================================================================
// KRIPTOQUANT — Nearest-Rank Percentile Calculator (Sprint 17)
// ============================================================================

/**
 * Bir sayı dizisinin belirtilen yüzdelik (percentile) dilimdeki değerini
 * Nearest-Rank (En Yakın Değer) yöntemi kullanarak hesaplar.
 *
 * @param values - Ham sayı dizisi (sıralı olması gerekmez, içeride kopyalanıp sıralanır)
 * @param percentile - Yüzdelik dilim (0 ile 100 arası, ör. 95)
 */
export function nearestRankPercentile(values: number[], percentile: number): number {
	if (values.length === 0) {
		return 0;
	}

	// Orijinal diziyi bozmamak için kopyalayıp sıralıyoruz
	const sorted = [...values].sort((a, b) => a - b);
	
	// Nearest-Rank Index formülü: Math.ceil((P/100) * N) - 1
	const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
	
	// Sınır kontrolleri
	const safeIdx = Math.max(0, Math.min(sorted.length - 1, idx));
	
	return sorted[safeIdx];
}
