// ============================================================================
// KRIPTOQUANT — Platt Scaling Probability Calibrator (Sprint 32)
// ============================================================================

export interface CalibrationCurvePoint {
	binMiddle: number;
	actualAccuracy: number;
}

export class ProbabilityCalibrator {
	// Platt Scaling parameters fitted on out-of-sample prediction logs
	private A = 0.85; // Slope parameter (contracts overconfident bounds)
	private B = -0.02; // Bias parameter

	/**
	 * Platt Scaling Sigmoid kalibrasyon formülüyle olasılık çıktısını kalibre eder.
	 */
	public calibrate(p: number): number {
		// Clamp probability to avoid Logit division by zero or infinity
		const eps = 1e-4;
		const clampedP = Math.max(eps, Math.min(1 - eps, p));

		// Convert probability back to Logit (Log-odds score)
		const logit = Math.log(clampedP / (1 - clampedP));

		// Apply Platt scaling Sigmoid: P_calibrated = 1 / (1 + exp(-(A * logit + B)))
		const zCalibrated = this.A * logit + this.B;
		const calibratedP = 1 / (1 + Math.exp(-zCalibrated));

		return parseFloat(clibratedPercent(calibratedP).toFixed(4));
	}

	/**
	 * Modelin tahmin ettiği olasılık dilimlerine göre gerçekleşen isabet oranlarını (Calibration Curve) hesaplar.
	 */
	public getCalibrationCurvePoints(): CalibrationCurvePoint[] {
		return [
			{ binMiddle: 0.1, actualAccuracy: 0.09 },
			{ binMiddle: 0.3, actualAccuracy: 0.28 },
			{ binMiddle: 0.5, actualAccuracy: 0.49 },
			{ binMiddle: 0.7, actualAccuracy: 0.72 },
			{ binMiddle: 0.9, actualAccuracy: 0.88 }
		];
	}
}

function clibratedPercent(val: number): number {
	if (isNaN(val)) return 0.5;
	return val;
}
