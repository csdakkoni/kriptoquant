// ============================================================================
// KRIPTOQUANT — Bayesian Strategy Weighting & Online Learning (Sprint 30)
// ============================================================================

export class BayesianStrategyWeighting {
	private recentTrades: Record<string, boolean[]> = {};
	private windowSize = 20;

	/**
	 * Strateji için yeni bir işlem sonucunu (Win=true, Loss=false) veritabanına ekler.
	 */
	public recordTradeResult(strategyName: string, isWin: boolean) {
		if (!this.recentTrades[strategyName]) {
			this.recentTrades[strategyName] = [];
		}

		this.recentTrades[strategyName].push(isWin);

		// Son 20 işlemi pencereler halinde tutar (online sliding window)
		if (this.recentTrades[strategyName].length > this.windowSize) {
			this.recentTrades[strategyName].shift();
		}
	}

	/**
	 * Bayes Teoremi ile stratejinin posterior başarı ihtimalini ve güncellenmiş oylama ağırlığını hesaplar.
	 * 
	 * @param strategyName - Stratejinin adı (örn: ema-cross)
	 * @param priorWinRate - Geçmiş backtest win rate oranı (örn: 0.45)
	 */
	public calculatePosteriorWeight(strategyName: string, priorWinRate: number): number {
		const priorSuccess = priorWinRate; // P(S)
		const recent = this.recentTrades[strategyName] ?? [];

		if (recent.length === 0) {
			return priorSuccess; // Veri yoksa prior'a bağlı kal
		}

		// Son işlemler içerisindeki başarı oranı (Likelihood) -> P(Win | S)
		const wins = recent.filter(w => w).length;
		const likelihood = wins / recent.length;

		// Strateji başarısız olduğundaki gürültü/şans faktörü -> P(Win | ~S)
		const noise = 0.35; 

		// Bayes Teoremi: P(S | Win) = [P(Win | S) * P(S)] / [P(Win | S) * P(S) + P(Win | ~S) * P(~S)]
		const numerator = likelihood * priorSuccess;
		const denominator = likelihood * priorSuccess + noise * (1 - priorSuccess);

		if (denominator === 0) return 0.05;

		const posterior = numerator / denominator;

		// Değer [0.05, 1.0] aralığında normalleştirilir
		return parseFloat(Math.max(0.05, Math.min(1.0, posterior)).toFixed(4));
	}
}
