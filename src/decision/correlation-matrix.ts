// ============================================================================
// KRIPTOQUANT — Pearson Correlation Matrix (Sprint 29)
// ============================================================================

export class CorrelationMatrix {
	/**
	 * İki fiyat serisinin günlük getiri yüzdeleri arasındaki Pearson korelasyon katsayısını (correlation coefficient) hesaplar.
	 */
	public calculatePearsonCorrelation(pricesX: number[], pricesY: number[]): number {
		const n = Math.min(pricesX.length, pricesY.length);
		if (n < 5) return 0; // Yetersiz veri

		// Günlük logaritmik veya yüzde getirileri hesapla
		const returnsX: number[] = [];
		const returnsY: number[] = [];

		for (let i = 1; i < n; i++) {
			returnsX.push((pricesX[i] - pricesX[i - 1]) / pricesX[i - 1]);
			returnsY.push((pricesY[i] - pricesY[i - 1]) / pricesY[i - 1]);
		}

		const m = returnsX.length;
		if (m === 0) return 0;

		// Ortalama (Mean)
		const meanX = returnsX.reduce((a, b) => a + b, 0) / m;
		const meanY = returnsY.reduce((a, b) => a + b, 0) / m;

		// Kovaryans ve Standart Sapma paydaları
		let num = 0;
		let denX = 0;
		let denY = 0;

		for (let i = 0; i < m; i++) {
			const diffX = returnsX[i] - meanX;
			const diffY = returnsY[i] - meanY;
			
			num += diffX * diffY;
			denX += diffX * diffX;
			denY += diffY * diffY;
		}

		if (denX === 0 || denY === 0) return 0;

		const correlation = num / Math.sqrt(denX * denY);
		
		// Katsayı [-1, 1] aralığına kırpılır (Floating point hassasiyeti için)
		return Math.max(-1, Math.min(1, correlation));
	}

	/**
	 * Korelasyon matrisini kullanarak Recommended Allocation oranını yüksek korelasyon durumlarında azaltır.
	 */
	public applyCorrelationShaving(
		allocations: { asset: string; percentage: number }[],
		correlations: Record<string, Record<string, number>>
	): { asset: string; percentage: number }[] {
		const shaved = allocations.map(item => ({ ...item }));
		const threshold = 0.85;

		for (let i = 0; i < shaved.length; i++) {
			for (let j = i + 1; j < shaved.length; j++) {
				const assetA = shaved[i].asset;
				const assetB = shaved[j].asset;

				if (assetA === 'CASH' || assetB === 'CASH') continue;

				const rho = correlations[assetA]?.[assetB] ?? correlations[assetB]?.[assetA] ?? 0;

				if (rho > threshold) {
					// Yüksek korelasyon durumunda, risk katsayısına göre düşük pay ayrılanı tıraşla
					if (shaved[i].percentage >= shaved[j].percentage) {
						// Shave asset B
						const factor = 1 - (rho - threshold) * 2.0; // correlation = 0.90 -> factor = 0.90
						shaved[j].percentage = Math.round(shaved[j].percentage * Math.max(0.2, factor));
					} else {
						// Shave asset A
						const factor = 1 - (rho - threshold) * 2.0;
						shaved[i].percentage = Math.round(shaved[i].percentage * Math.max(0.2, factor));
					}
				}
			}
		}

		return shaved;
	}
}
