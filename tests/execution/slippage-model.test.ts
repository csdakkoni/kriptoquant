import { describe, it, expect, beforeEach } from 'vitest';
import { SlippageModel } from '../../src/execution/slippage-model.js';

describe('SlippageModel Unit Tests', () => {
	let model: SlippageModel;

	beforeEach(() => {
		model = new SlippageModel();
	});

	it('should calculate commissions, spreads and market impact slippage accurately', () => {
		const cost = model.calculateTotalExecutionCost(10, 100, 0.02, true); // buy order
		expect(cost.commissionUsdt).toBeGreaterThan(0);
		expect(cost.slippageUsdt).toBeGreaterThan(0);
		expect(cost.spreadUsdt).toBeGreaterThan(0);
		expect(cost.executionPrice).toBeGreaterThan(100);
	});

	it('should penalize larger order sizes with higher Kyle Lambda slippage costs', () => {
		const costSmall = model.calculateTotalExecutionCost(10, 100, 0.02, true);
		const costBig = model.calculateTotalExecutionCost(50000, 100, 0.02, true);

		// Volatility adjusted slippage ratio should be higher for larger relative size
		const slipRatioSmall = (costSmall.executionPrice - 100) / 100;
		const slipRatioBig = (costBig.executionPrice - 100) / 100;
		expect(slipRatioBig).toBeGreaterThan(slipRatioSmall);
	});
});
