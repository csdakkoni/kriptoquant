import { describe, it, expect, beforeEach } from 'vitest';
import { HrpOptimizer } from '../../src/research/hrp.js';

describe('HrpOptimizer Unit Tests', () => {
	let optimizer: HrpOptimizer;

	beforeEach(() => {
		optimizer = new HrpOptimizer();
	});

	it('should calculate Hierarchical Risk Parity weights summing up to 100%', () => {
		const coins = ['BTC', 'ETH', 'SOL'];
		const corr = [
			[1.00, 0.85, 0.65],
			[0.85, 1.00, 0.70],
			[0.65, 0.70, 1.00]
		];
		const vols = [0.02, 0.03, 0.05];

		const allocations = optimizer.calculateHrpWeights(coins, corr, vols);
		expect(allocations.length).toBe(3);

		let totalWeight = 0;
		allocations.forEach(a => {
			expect(a.coin).toBeDefined();
			expect(a.weight).toBeGreaterThan(0);
			expect(a.weight).toBeLessThan(1.0);
			totalWeight += a.weight;
		});

		expect(totalWeight).toBeCloseTo(1.0, 4);
	});
});
