// ============================================================================
// KRIPTOQUANT — Risk Manager Tests
// ============================================================================

import { describe, expect, it } from 'vitest';
import { evaluateRisk } from '../../src/core/risk/risk-manager.js';
import type { RiskConfig, Signal } from '../../src/core/types.js';

const defaultRiskConfig: RiskConfig = {
	maxPositionPercent: 20,
	maxDailyLossPercent: 5,
	maxOrderValue: 2000,
	stopLossAtrMultiplier: 2,
};

function makeSignal(side: 'BUY' | 'SELL'): Signal {
	return {
		timestamp: Date.now(),
		side,
		price: 50000,
		confidence: 0.8,
		reason: 'Test signal',
	};
}

describe('evaluateRisk', () => {
	it('should approve a normal BUY signal', () => {
		const decision = evaluateRisk(
			makeSignal('BUY'),
			10000, // 10K sermaye
			0, // Günlük P&L = 0
			defaultRiskConfig,
		);

		expect(decision.approved).toBe(true);
		expect(decision.positionSize).toBeGreaterThan(0);
	});

	it('should limit position size to maxPositionPercent', () => {
		const decision = evaluateRisk(
			makeSignal('BUY'),
			10000,
			0,
			defaultRiskConfig,
		);

		// %20 of 10K = 2000, maxOrderValue = 2000 → min(2000, 2000) = 2000
		expect(decision.positionSize).toBeLessThanOrEqual(2000);
	});

	it('should limit position size to maxOrderValue', () => {
		const config: RiskConfig = { ...defaultRiskConfig, maxOrderValue: 500 };
		const decision = evaluateRisk(makeSignal('BUY'), 10000, 0, config);

		expect(decision.positionSize).toBeLessThanOrEqual(500);
	});

	it('should reject when daily loss limit is exceeded', () => {
		const decision = evaluateRisk(
			makeSignal('BUY'),
			10000,
			-600, // %5 of 10K = 500, günlük kayıp 600 > 500
			defaultRiskConfig,
		);

		expect(decision.approved).toBe(false);
		expect(decision.reason).toContain('Günlük kayıp limiti');
	});

	it('should approve when daily loss is within limit', () => {
		const decision = evaluateRisk(
			makeSignal('BUY'),
			10000,
			-400, // %5 of 10K = 500, günlük kayıp 400 < 500
			defaultRiskConfig,
		);

		expect(decision.approved).toBe(true);
	});

	it('should reject when position size is too small', () => {
		const decision = evaluateRisk(
			makeSignal('BUY'),
			30, // %20 of 30 = 6 < 10 minimum
			0,
			defaultRiskConfig,
		);

		expect(decision.approved).toBe(false);
		expect(decision.reason).toContain('çok küçük');
	});
});
