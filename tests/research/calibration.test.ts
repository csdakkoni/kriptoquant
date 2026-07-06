import { describe, it, expect, beforeEach } from 'vitest';
import { ProbabilityCalibrator } from '../../src/research/calibration.js';

describe('ProbabilityCalibrator Unit Tests', () => {
	let calibrator: ProbabilityCalibrator;

	beforeEach(() => {
		calibrator = new ProbabilityCalibrator();
	});

	it('should calibrate raw logistic probabilities to Platt Scaling bounds', () => {
		const rawProb = 0.95;
		const calibrated = calibrator.calibrate(rawProb);

		// Calibrated probability should be clamped slightly lower to account for overconfidence
		expect(calibrated).toBeLessThan(rawProb);
		expect(calibrated).toBeGreaterThan(0.5);

		// Should scale low probabilities correctly
		const lowProb = 0.10;
		const calibratedLow = calibrator.calibrate(lowProb);
		expect(calibratedLow).toBeGreaterThan(lowProb);
	});

	it('should generate valid calibration curve points', () => {
		const points = calibrator.getCalibrationCurvePoints();
		expect(points.length).toBe(5);
		expect(points[0].binMiddle).toBe(0.1);
	});
});
