import { describe, it, expect, beforeEach } from 'vitest';
import { StressTestingEngine } from '../../src/decision/stress-testing.js';

describe('StressTestingEngine Unit Tests', () => {
	let engine: StressTestingEngine;

	beforeEach(() => {
		engine = new StressTestingEngine();
	});

	it('should calculate Expected Shortfall (CVaR) correctly at 95% confidence', () => {
		// Mock returns: worst returns are -0.05, -0.04
		const returns = [-0.05, -0.04, -0.01, 0.01, 0.02, 0.03, 0.01, 0.02, 0.01, 0.03, 0.01, 0.02, 0.01, 0.03, 0.01, 0.02, 0.01, 0.03, 0.01, 0.02];
		
		const cvar = engine.calculateCVaR95(returns);
		expect(cvar).toBeDefined();
		expect(cvar).toBeGreaterThan(0);
		expect(cvar).toBeLessThan(0.10);
	});

	it('should run macro stress tests and calculate expected losses', () => {
		const res = engine.runMacroStressTests(10000, 20); // 10k equity, 20% risk allocation
		expect(res.length).toBe(3);
		expect(res[0].scenarioName).toBe('Black Swan Event');
		expect(res[0].expectedLossUsdt).toBe(400); // 10000 * 0.20 * 0.20
		expect(res[0].impactSeverity).toBe('CRITICAL');
	});

	it('should scale allocations down if CVaR exceeds target limit', () => {
		const allocations = [
			{ asset: 'BTC', percentage: 15 },
			{ asset: 'ETH', percentage: 12 },
			{ asset: 'CASH', percentage: 73 }
		];

		// CVaR = 25% (> 15% limit) -> scaleFactor = 15 / 25 = 0.60
		const shaved = engine.applyCVaRShaving(allocations, 0.25);
		
		const btcAlloc = shaved.find(i => i.asset === 'BTC');
		expect(btcAlloc?.percentage).toBe(9); // 15 * 0.60 = 9

		const ethAlloc = shaved.find(i => i.asset === 'ETH');
		expect(ethAlloc?.percentage).toBe(7); // 12 * 0.60 = 7.2 -> 7
	});
});
