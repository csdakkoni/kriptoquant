// ============================================================================
// KRIPTOQUANT — Meta-Labeling & Secondary Veto Engine (Sprint 33)
// ============================================================================

export interface MetaLabelingOutput {
	primarySignal: 'BUY' | 'SELL' | 'WAIT';
	metaProbability: number; // Probability that the primary trade will succeed (0.0 - 1.0)
	action: 'EXECUTE' | 'VETO_SKIP';
}

export class MetaLabeler {
	private vetoThreshold = 0.55; // Secondary model execution threshold (55%)

	/**
	 * Meta-Labeling mantığıyla birincil sinyalin karlı çıkma ihtimalini değerlendirip onay/veto üretir.
	 * 
	 * @param primarySignal - Birincil stratejinin/consensus'un sinyali (BUY/SELL)
	 * @param features - Anlık indikatör ve rejim özellik vektörü
	 */
	public evaluateMetaLabel(
		primarySignal: 'BUY' | 'SELL' | 'WAIT',
		features: {
			rsiVal: number;
			adxVal: number;
			atrPercentile: number;
			volumeSpike: number;
		}
	): MetaLabelingOutput {
		if (primarySignal === 'WAIT') {
			return { primarySignal, metaProbability: 0.50, action: 'VETO_SKIP' };
		}

		// Calculate secondary meta probability: z = w.X + b
		// Let's model a secondary classifier that determines trade entry safety
		let z = 0.05;
		
		// If volume is high (volumeSpike = 1) and ADX shows strong trend, probability increases
		if (features.volumeSpike === 1) z += 0.25;
		if (features.adxVal > 25) z += 0.15;
		
		// If RSI is extremely overbought/oversold, probability decreases slightly
		if (features.rsiVal > 70 || features.rsiVal < 30) {
			z -= 0.20;
		}

		// Sigmoid Activation
		const metaProbability = 1 / (1 + Math.exp(-z));
		const action = metaProbability >= this.vetoThreshold ? 'EXECUTE' : 'VETO_SKIP';

		return {
			primarySignal,
			metaProbability: parseFloat(metaProbability.toFixed(4)),
			action
		};
	}
}
