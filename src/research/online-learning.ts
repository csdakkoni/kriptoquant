// ============================================================================
// KRIPTOQUANT — Online Learning & Recalibration Engine (Sprint 36)
// ============================================================================

export interface CalibrationParams {
	A: number;
	B: number;
}

export class OnlineLearner {
	/**
	 * Stochastic Gradient Descent (SGD) kurallarına göre model katsayılarını online günceller.
	 * 
	 * @param weights - Güncellenecek model katsayıları dizisi (referans olarak güncellenir)
	 * @param features - Anlık işlem girdi özellik vektörü
	 * @param actualOutcome - Gerçekleşen işlem sonucu (1: Karlı/TP, 0: Zararlı/SL)
	 * @param predictedProbability - Modelin ham olasılık tahmini
	 * @param learningRate - Öğrenme hızı (learning rate, örn: 0.05)
	 */
	public updateWeightsSGD(
		weights: number[],
		features: number[],
		actualOutcome: number,
		predictedProbability: number,
		learningRate: number = 0.05
	): number[] {
		const error = actualOutcome - predictedProbability;

		for (let i = 0; i < weights.length; i++) {
			const xVal = features[i] ?? 0;
			// SGD Update: w = w + lr * error * x
			weights[i] += learningRate * error * xVal;
			weights[i] = parseFloat(weights[i].toFixed(6));
		}

		return weights;
	}

	/**
	 * Platt Scaling sigmoid A ve B katsayılarını anlık log-loss gradyan inişi (gradient descent) ile optimize eder.
	 * 
	 * @param A - Platt Scaling sigmoid çarpanı
	 * @param B - Platt Scaling sigmoid bias parametresi
	 * @param logit - Lojistik modelden gelen ham logit tahmini
	 * @param actualOutcome - Gerçekleşen işlem sonucu (1 veya 0)
	 * @param learningRate - Gradyan öğrenme hızı (learning rate, örn: 0.1)
	 */
	public updatePlattCalibrator(
		A: number,
		B: number,
		logit: number,
		actualOutcome: number,
		learningRate: number = 0.1
	): CalibrationParams {
		// Sigmoid prediction: P = 1 / (1 + exp(-(A * logit + B)))
		const z = A * logit + B;
		const P = 1.0 / (1.0 + Math.exp(-z));

		// Gradient of log-loss with respect to A and B
		// dL/dA = (P - y) * logit
		// dL/dB = (P - y)
		const gradA = (P - actualOutcome) * logit;
		const gradB = (P - actualOutcome);

		// Gradient descent update rules
		const newA = A - learningRate * gradA;
		const newB = B - learningRate * gradB;

		return {
			A: parseFloat(newA.toFixed(4)),
			B: parseFloat(newB.toFixed(4))
		};
	}
}
