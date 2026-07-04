// ============================================================================
// KRIPTOQUANT — Donchian Breakout Strategy Tests (Sprint 8)
// ============================================================================
// Breakout detection, false breakout handling, warmup, pipeline integration
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle, PlatformConfig, RiskConfig } from '../../src/core/types.js';
import { createDonchianBreakoutStrategy } from '../../src/research/strategies/donchian-breakout/index.js';
import { runExperiment, generateCombinations, type SweepConfig } from '../../src/research/experiments/runner.js';

// ─── Test Data ───────────────────────────────────────────────────────────────

function makeBreakoutCandles(): Candle[] {
	// 25 candles: 20 range-bound + 5 upward breakout
	const candles: Candle[] = [];

	// Range-bound: price between 95-105
	for (let i = 0; i < 20; i++) {
		candles.push({
			openTime: i * 86400000,
			open: 100,
			high: 105,
			low: 95,
			close: 100 + (i % 2 === 0 ? 2 : -2),
			volume: 1000,
			closeTime: (i + 1) * 86400000 - 1,
		});
	}

	// Breakout: price surges above 105 (previous upper channel)
	for (let i = 20; i < 25; i++) {
		const base = 100 + (i - 20) * 5;
		candles.push({
			openTime: i * 86400000,
			open: base,
			high: base + 8,
			low: base - 2,
			close: base + 5,
			volume: 3000,
			closeTime: (i + 1) * 86400000 - 1,
		});
	}

	return candles;
}

function makeDownBreakCandles(): Candle[] {
	const candles: Candle[] = [];

	// Range-bound
	for (let i = 0; i < 20; i++) {
		candles.push({
			openTime: i * 86400000,
			open: 100,
			high: 105,
			low: 95,
			close: 100,
			volume: 1000,
			closeTime: (i + 1) * 86400000 - 1,
		});
	}

	// Breakdown: price drops below 95 (previous lower channel)
	for (let i = 20; i < 25; i++) {
		const base = 100 - (i - 20) * 5;
		candles.push({
			openTime: i * 86400000,
			open: base,
			high: base + 2,
			low: base - 8,
			close: base - 5,
			volume: 3000,
			closeTime: (i + 1) * 86400000 - 1,
		});
	}

	return candles;
}

const platformConfig: PlatformConfig = {
	coins: ['BTCUSDT'],
	defaultInterval: '1d',
	initialCapital: 10000,
	commissionPercent: 0.10,
	slippagePercent: 0.05,
};

const riskConfig: RiskConfig = {
	maxPositionPercent: 100,
	maxDailyLossPercent: 5,
	maxOrderValue: 10000,
	stopLossAtrMultiplier: 2.0,
};

// ─── Breakout Tests ──────────────────────────────────────────────────────────

describe('Donchian Breakout Strategy', () => {
	it('should detect upward breakout', () => {
		const candles = makeBreakoutCandles();
		const strategy = createDonchianBreakoutStrategy(20);
		const signals = strategy.evaluate(candles);

		const buySignals = signals.filter((s) => s.side === 'BUY');
		expect(buySignals.length).toBeGreaterThanOrEqual(1);
		// First BUY should be around candle 20+ (after range-bound period)
		expect(buySignals[0].timestamp).toBeGreaterThanOrEqual(20 * 86400000);
	});

	it('should detect downward breakout', () => {
		const candles = makeDownBreakCandles();
		const strategy = createDonchianBreakoutStrategy(20);
		const signals = strategy.evaluate(candles);

		const sellSignals = signals.filter((s) => s.side === 'SELL');
		expect(sellSignals.length).toBeGreaterThanOrEqual(1);
	});

	it('should not signal during range-bound (no false breakouts)', () => {
		// Only range-bound candles — no breakout should occur
		const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
			openTime: i * 86400000,
			open: 100,
			high: 105,
			low: 95,
			close: 100 + (i % 3 - 1),
			volume: 1000,
			closeTime: (i + 1) * 86400000 - 1,
		}));

		const strategy = createDonchianBreakoutStrategy(20);
		const signals = strategy.evaluate(candles);

		// Close stays between 95-105, channel is exactly 95-105, so no breakout
		expect(signals.length).toBe(0);
	});

	it('should respect warmup period', () => {
		const candles = makeBreakoutCandles();
		const strategy = createDonchianBreakoutStrategy(20);

		expect(strategy.warmupPeriod).toBe(21);
		expect(strategy.name).toBe('donchian-breakout');

		const signals = strategy.evaluate(candles);
		// No signals should have timestamps before warmup
		for (const s of signals) {
			expect(s.timestamp).toBeGreaterThanOrEqual(20 * 86400000);
		}
	});

	it('should include channel metadata in signals', () => {
		const candles = makeBreakoutCandles();
		const strategy = createDonchianBreakoutStrategy(20);
		const signals = strategy.evaluate(candles);

		if (signals.length > 0) {
			const s = signals[0];
			expect(s.metadata).toBeDefined();
			expect(typeof s.metadata!.indicatorFast).toBe('number'); // upper channel
			expect(typeof s.metadata!.indicatorSlow).toBe('number'); // lower channel
		}
	});

	it('should support custom period via factory', () => {
		const s10 = createDonchianBreakoutStrategy(10);
		const s30 = createDonchianBreakoutStrategy(30);

		expect(s10.warmupPeriod).toBe(11);
		expect(s10.description).toContain('10');
		expect(s30.warmupPeriod).toBe(31);
		expect(s30.description).toContain('30');
	});
});

// ─── Pipeline Integration Tests ──────────────────────────────────────────────

describe('Donchian Pipeline Integration', () => {
	it('should work through full experiment pipeline', () => {
		const candles = makeBreakoutCandles();
		const result = runExperiment(candles, {
			strategyName: 'donchian-breakout',
			donchianPeriod: 20,
			adxVetoThreshold: 15,
			rvolVetoThreshold: 1.0,
			minimumConfidence: 60,
		}, platformConfig, riskConfig, 'TEST');

		expect(result.params.strategyName).toBe('donchian-breakout');
		expect(typeof result.totalReturn).toBe('number');
		expect(typeof result.sharpeRatio).toBe('number');
		expect(result.totalSignals).toBeGreaterThanOrEqual(0);
	});

	it('should be deterministic', () => {
		const candles = makeBreakoutCandles();
		const params = {
			strategyName: 'donchian-breakout',
			donchianPeriod: 20,
			adxVetoThreshold: 20,
			rvolVetoThreshold: 1.5,
			minimumConfidence: 70,
		};

		const r1 = runExperiment(candles, params, platformConfig, riskConfig, 'TEST');
		const r2 = runExperiment(candles, params, platformConfig, riskConfig, 'TEST');

		expect(r1.totalReturn).toBe(r2.totalReturn);
		expect(r1.totalTrades).toBe(r2.totalTrades);
	});
});

// ─── Multi-Strategy Sweep Tests ──────────────────────────────────────────────

describe('Multi-Strategy Sweep', () => {
	it('should generate combinations for both strategies', () => {
		const config: SweepConfig = {
			emaFast: [9],
			emaSlow: [21],
			donchianPeriod: [20],
			adxVetoThreshold: [20],
			rvolVetoThreshold: [1.5],
			minimumConfidence: [70],
		};

		const combos = generateCombinations(config);
		const ema = combos.filter((c) => c.strategyName === 'ema-cross');
		const dc = combos.filter((c) => c.strategyName === 'donchian-breakout');

		expect(ema).toHaveLength(1);
		expect(dc).toHaveLength(1);
		expect(combos).toHaveLength(2);
	});

	it('should generate only donchian if no EMA params', () => {
		const config: SweepConfig = {
			donchianPeriod: [10, 20],
			adxVetoThreshold: [15, 20],
			rvolVetoThreshold: [1.5],
			minimumConfidence: [70],
		};

		const combos = generateCombinations(config);
		expect(combos.every((c) => c.strategyName === 'donchian-breakout')).toBe(true);
		expect(combos).toHaveLength(4); // 2 periods × 2 adx × 1 rvol × 1 conf
	});
});
