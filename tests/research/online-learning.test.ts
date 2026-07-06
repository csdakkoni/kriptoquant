import { describe, it, expect, beforeEach } from 'vitest';
import { OnlineLearner } from '../../src/research/online-learning.js';

describe('OnlineLearner Unit Tests', () => {
	let learner: OnlineLearner;

	beforeEach(() => {
		learner = new OnlineLearner();
	});

	it('should tune model coefficients towards outcome using SGD', () => {
		const weights = [0.5, 0.2];
		const features = [1.0, 0.5];
		
		// Expected outcome is 1.0 (win), predicted was 0.6. Error is positive +0.4.
		// Weights should increase
		const updated = learner.updateWeightsSGD(weights, features, 1.0, 0.6, 0.1);
		expect(updated[0]).toBeGreaterThan(0.5);
		expect(updated[1]).toBeGreaterThan(0.2);
	});

	it('should optimize Platt scaling calibrator parameters dynamically via log-loss gradient descent', () => {
		const A = -1.0;
		const B = 0.0;
		const logit = 2.0;
		
		// actual win (1.0), since z = -2, initial sigmoid probability is very low (0.1192).
		// gradient updates should shift z higher (reduce calibration error)
		const nextParams = learner.updatePlattCalibrator(A, B, logit, 1.0, 0.2);
		expect(nextParams.A).toBeGreaterThan(-1.0); // should adjust parameter to fit target
		expect(nextParams.B).toBeGreaterThan(0.0);
	});
});
