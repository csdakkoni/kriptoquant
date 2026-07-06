import { describe, it, expect, beforeEach } from 'vitest';
import { MonteCarloSimulator } from '../../src/decision/monte-carlo.js';

describe('MonteCarloSimulator Unit Tests', () => {
	let simulator: MonteCarloSimulator;

	beforeEach(() => {
		simulator = new MonteCarloSimulator();
	});

	it('should simulate risk paths and compute probabilities within [0.0, 1.0]', () => {
		const res = simulator.simulateRisk(10000, 0.45, 2.2, 1.0, 30);
		expect(res.ruinProbability).toBeGreaterThanOrEqual(0.0);
		expect(res.ruinProbability).toBeLessThanOrEqual(1.0);
		expect(res.expectedMaxDrawdown).toBeGreaterThanOrEqual(0.0);
		expect(res.expectedMaxDrawdown).toBeLessThanOrEqual(1.0);
		expect(res.medianEndingEquity).toBeGreaterThan(0);
	});
});
