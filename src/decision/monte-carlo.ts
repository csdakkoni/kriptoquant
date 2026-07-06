// ============================================================================
// KRIPTOQUANT — Monte Carlo Risk Simulator (Sprint 30)
// ============================================================================

export interface MonteCarloResult {
	ruinProbability: number; // 0.0 - 1.0
	expectedMaxDrawdown: number; // 0.0 - 1.0
	medianEndingEquity: number;
}

export class MonteCarloSimulator {
	/**
	 * Verilen strateji metrikleri doğrultusunda 1,000 adet sermaye patikası simüle eder.
	 * 
	 * @param initialEquity - Başlangıç sermayesi (örn: 10000)
	 * @param winRate - Strateji başarı yüzdesi (örn: 0.45)
	 * @param averageR - Ortalama R-multiple ödül katsayısı (örn: 2.2)
	 * @param riskPercentage - İşlem başına riske edilen portföy yüzdesi (örn: 1)
	 * @param numTrades - Patika başına simüle edilecek işlem sayısı (örn: 50)
	 */
	public simulateRisk(
		initialEquity: number,
		winRate: number,
		averageR: number,
		riskPercentage: number = 1.0,
		numTrades: number = 50
	): MonteCarloResult {
		const numPaths = 1000;
		let ruinedPaths = 0;
		let totalMaxDrawdown = 0;
		const endingEquities: number[] = [];

		const ruinThreshold = initialEquity * 0.50; // %50 kayıpta iflas (ruin) kabul edilir

		for (let p = 0; p < numPaths; p++) {
			let equity = initialEquity;
			let peak = initialEquity;
			let maxDd = 0;
			let ruined = false;

			for (let t = 0; t < numTrades; t++) {
				const isWin = Math.random() < winRate;
				const riskUsdt = equity * (riskPercentage / 100);

				if (isWin) {
					equity += riskUsdt * averageR;
				} else {
					equity -= riskUsdt;
				}

				if (equity <= 0) {
					equity = 0;
					ruined = true;
					break;
				}

				if (equity < ruinThreshold) {
					ruined = true;
				}

				// Drawdown hesaplama
				if (equity > peak) {
					peak = equity;
				} else {
					const dd = (peak - equity) / peak;
					if (dd > maxDd) maxDd = dd;
				}
			}

			if (ruined) ruinedPaths++;
			totalMaxDrawdown += maxDd;
			endingEquities.push(equity);
		}

		// Median ending equity hesaplama
		endingEquities.sort((a, b) => a - b);
		const medianEndingEquity = endingEquities[Math.floor(endingEquities.length / 2)];

		return {
			ruinProbability: parseFloat((ruinedPaths / numPaths).toFixed(4)),
			expectedMaxDrawdown: parseFloat((totalMaxDrawdown / numPaths).toFixed(4)),
			medianEndingEquity: Math.round(medianEndingEquity)
		};
	}
}
