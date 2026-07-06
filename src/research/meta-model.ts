// ============================================================================
// KRIPTOQUANT — Logistic Regression Meta Model Engine (Sprint 31)
// ============================================================================

export interface MetaPrediction {
	probabilityOfProfit: number; // 0.0 - 1.0 (calibrated probability)
	decision: 'TRADE' | 'SKIP';
}

export class MetaModelEngine {
	// Calibrated weights for predicting P(Trade > 0 | Features)
	// Feature index: [emaSlope, adxVal, atrPercentile, rsiVal, volumeSpike]
	private weights = {
		emaSlope: 25.5,      // Positive trend slope strongly correlates with profitability
		adxVal: 0.015,       // Stronger ADX trend correlates slightly positive
		atrPercentile: -0.2, // Extremely high volatility slightly reduces winning probability
		rsiVal: -0.005,      // Extremely overbought RSI slightly reduces probability
		volumeSpike: 0.35    // Volume spike increases trade winning probability
	};
	private bias = -0.15; // Sigmoid activation threshold offset

	/**
	 * Logistic Regression sigmoid formülüyle bir sonraki işlemin karlı olma olasılığını (P(Profit)) tahmin eder.
	 */
	public predictProfitProbability(features: {
		emaSlope: number;
		adxVal: number;
		atrPercentile: number;
		rsiVal: number;
		volumeSpike: number;
	}): MetaPrediction {
		// Log-odds score calculation: z = w.X + b
		let z = this.bias;
		z += features.emaSlope * this.weights.emaSlope;
		z += features.adxVal * this.weights.adxVal;
		z += features.atrPercentile * this.weights.atrPercentile;
		z += features.rsiVal * this.weights.rsiVal;
		z += features.volumeSpike * this.weights.volumeSpike;

		// Sigmoid Activation Function: P(Y=1) = 1 / (1 + exp(-z))
		const probabilityOfProfit = 1 / (1 + Math.exp(-z));

		// Decision Threshold: P(Profit) > 52% means TRADE, else SKIP
		const decision = probabilityOfProfit > 0.52 ? 'TRADE' : 'SKIP';

		return {
			probabilityOfProfit: parseFloat(probabilityOfProfit.toFixed(4)),
			decision
		};
	}
}
