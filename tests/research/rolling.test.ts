// ============================================================================
// KRIPTOQUANT — Rolling Walk-Forward Tests (Sprint 10)
// ============================================================================
// Window generation, leakage kontrolü, robustness score, export
// ============================================================================

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { Candle, PlatformConfig, RiskConfig } from '../../src/core/types.js';
import {
	generateRollingWindows,
	calculateRobustness,
	runRollingWalkForward,
	exportRollingCSV,
	exportRollingSummaryJSON,
	type WindowResult,
} from '../../src/research/walkforward/rolling.js';
import type { WalkForwardMetrics, GeneralizationScore } from '../../src/research/walkforward/walkforward.js';

// ─── Test Data ───────────────────────────────────────────────────────────────

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

function makeSequentialCandles(count: number): Candle[] {
	return Array.from({ length: count }, (_, i) => {
		const base = 100 + i * 2;
		const ts = i * 86400000;
		return {
			openTime: ts,
			open: base,
			high: base + 5,
			low: base - 2,
			close: base + 3,
			volume: 1000 + i * 10,
			closeTime: ts + 86400000 - 1,
		};
	});
}

function makeMetrics(overrides: Partial<WalkForwardMetrics> = {}): WalkForwardMetrics {
	return {
		totalReturn: 0, sharpeRatio: 0, profitFactor: 0, maxDrawdown: 0,
		totalTrades: 0, winRate: 0, alpha: 0, totalSignals: 0, acceptedSignals: 0,
		...overrides,
	};
}

function makeWindowResult(
	windowIndex: number,
	passed: boolean,
	trainReturn: number,
	testReturn: number,
	testSharpe: number = 0,
	testDD: number = 5,
): WindowResult {
	return {
		windowIndex,
		bestParams: {
			strategyName: 'donchian-breakout', donchianPeriod: 20,
			adxVetoThreshold: 20, rvolVetoThreshold: 1.5, minimumConfidence: 70,
		},
		trainMetrics: makeMetrics({ totalReturn: trainReturn }),
		testMetrics: makeMetrics({ totalReturn: testReturn, sharpeRatio: testSharpe, maxDrawdown: testDD }),
		generalization: { retention: passed ? 80 : 0, label: passed ? 'GOOD' : 'FAILED', emoji: passed ? '🟡' : '❌' },
		trainPeriod: { start: '2023-01-01', end: '2024-01-01', startTs: 0, endTs: 1, candleCount: 365 },
		testPeriod: { start: '2024-01-01', end: '2024-06-01', startTs: 2, endTs: 3, candleCount: 180 },
		passed,
	};
}

// ─── Window Generation Tests ─────────────────────────────────────────────────

describe('generateRollingWindows', () => {
	it('should generate correct number of windows', () => {
		const windows = generateRollingWindows(1000, 5, 0.70);
		expect(windows).toHaveLength(5);
	});

	it('should have non-overlapping test periods', () => {
		const windows = generateRollingWindows(1000, 5, 0.70);

		for (let i = 1; i < windows.length; i++) {
			// Previous test ends where (or before) next test starts
			expect(windows[i - 1].testEnd).toBeLessThanOrEqual(windows[i].testStart);
		}
	});

	it('should NOT have future leak — train always before test', () => {
		const windows = generateRollingWindows(1000, 5, 0.70);

		for (const w of windows) {
			expect(w.trainEnd).toBeLessThanOrEqual(w.testStart);
			expect(w.trainStart).toBeLessThan(w.testStart);
		}
	});

	it('should have train ending at test start (no gap between train and test)', () => {
		const windows = generateRollingWindows(1000, 5, 0.70);

		for (const w of windows) {
			expect(w.trainEnd).toBe(w.testStart);
		}
	});

	it('should slide windows forward', () => {
		const windows = generateRollingWindows(1000, 5, 0.70);

		for (let i = 1; i < windows.length; i++) {
			expect(windows[i].trainStart).toBeGreaterThan(windows[i - 1].trainStart);
			expect(windows[i].testStart).toBeGreaterThan(windows[i - 1].testStart);
		}
	});

	it('should stay within data bounds', () => {
		const windows = generateRollingWindows(1000, 5, 0.70);

		for (const w of windows) {
			expect(w.trainStart).toBeGreaterThanOrEqual(0);
			expect(w.testEnd).toBeLessThanOrEqual(1000);
		}
	});

	it('should throw on too few windows', () => {
		expect(() => generateRollingWindows(1000, 1, 0.70)).toThrow();
	});

	it('should throw on too short data', () => {
		expect(() => generateRollingWindows(10, 5, 0.70)).toThrow();
	});

	it('should throw on invalid ratio', () => {
		expect(() => generateRollingWindows(1000, 5, 0)).toThrow();
		expect(() => generateRollingWindows(1000, 5, 1)).toThrow();
	});
});

// ─── Robustness Score Tests ──────────────────────────────────────────────────

describe('calculateRobustness', () => {
	it('should return high score when all windows pass', () => {
		const windows = [
			makeWindowResult(1, true, 10, 8, 1.5, 3),
			makeWindowResult(2, true, 12, 9, 1.3, 4),
			makeWindowResult(3, true, 11, 7, 1.4, 3.5),
		];

		const rob = calculateRobustness(windows);
		expect(rob.passRate).toBe(1);
		expect(rob.score).toBeGreaterThan(40);
		// All pass → should not be UNRELIABLE or FRAGILE
		expect(rob.label).not.toContain('UNRELIABLE');
	});

	it('should return low score when all windows fail', () => {
		const windows = [
			makeWindowResult(1, false, 10, -5, -1, 8),
			makeWindowResult(2, false, 8, -3, -0.5, 6),
			makeWindowResult(3, false, 15, -8, -2, 12),
		];

		const rob = calculateRobustness(windows);
		expect(rob.passRate).toBe(0);
		expect(rob.score).toBeLessThan(30);
	});

	it('should produce score between 0 and 100', () => {
		const windows = [
			makeWindowResult(1, true, 10, 5, 1, 5),
			makeWindowResult(2, false, 8, -2, -0.5, 7),
		];

		const rob = calculateRobustness(windows);
		expect(rob.score).toBeGreaterThanOrEqual(0);
		expect(rob.score).toBeLessThanOrEqual(100);
	});

	it('should calculate correct pass rate', () => {
		const windows = [
			makeWindowResult(1, true, 10, 5, 1, 3),
			makeWindowResult(2, false, 8, -2, -0.5, 5),
			makeWindowResult(3, true, 12, 6, 1.2, 4),
			makeWindowResult(4, false, 9, -1, -0.2, 6),
		];

		const rob = calculateRobustness(windows);
		expect(rob.passRate).toBe(0.5);
	});

	it('should compute stddev values', () => {
		const windows = [
			makeWindowResult(1, true, 10, 5, 1.5, 3),
			makeWindowResult(2, true, 10, 15, 3.0, 3),
		];

		const rob = calculateRobustness(windows);
		expect(rob.returnStdDev).toBeGreaterThan(0);
		expect(rob.sharpeStdDev).toBeGreaterThan(0);
	});
});

// ─── Rolling Walk-Forward Engine Tests ───────────────────────────────────────

describe('runRollingWalkForward', () => {
	it('should produce valid RollingResult', () => {
		const candles = makeSequentialCandles(200);
		const result = runRollingWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout', 3,
		);

		expect(result.windows.length).toBeGreaterThanOrEqual(2);
		expect(result.robustness).toBeDefined();
		expect(result.robustness.score).toBeGreaterThanOrEqual(0);
		expect(result.robustness.score).toBeLessThanOrEqual(100);
		expect(result.strategyName).toBe('donchian-breakout');
		expect(typeof result.durationMs).toBe('number');
	});

	it('should maintain chronological order across all windows', () => {
		const candles = makeSequentialCandles(200);
		const result = runRollingWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout', 3,
		);

		for (const w of result.windows) {
			expect(w.trainPeriod.endTs).toBeLessThan(w.testPeriod.startTs);
		}
	});

	it('should be deterministic', () => {
		const candles = makeSequentialCandles(200);

		const r1 = runRollingWalkForward(candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout', 3);
		const r2 = runRollingWalkForward(candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout', 3);

		expect(r1.robustness.score).toBe(r2.robustness.score);
		expect(r1.windows.length).toBe(r2.windows.length);
		for (let i = 0; i < r1.windows.length; i++) {
			expect(r1.windows[i].testMetrics.totalReturn).toBe(r2.windows[i].testMetrics.totalReturn);
		}
	});
});

// ─── Export Tests ────────────────────────────────────────────────────────────

describe('Rolling Export', () => {
	const testCsvPath = 'test-rolling.csv';
	const testJsonPath = 'test-rolling.json';

	it('should export valid CSV', () => {
		const candles = makeSequentialCandles(200);
		const result = runRollingWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout', 3,
		);

		exportRollingCSV(result, testCsvPath);
		expect(existsSync(testCsvPath)).toBe(true);

		const content = readFileSync(testCsvPath, 'utf-8');
		const lines = content.split('\n');
		expect(lines[0]).toContain('Window');
		expect(lines[0]).toContain('TrainReturn');
		expect(lines[0]).toContain('TestReturn');
		expect(lines[0]).toContain('Verdict');
		expect(lines.length).toBeGreaterThan(1);

		unlinkSync(testCsvPath);
	});

	it('should export valid JSON with robustness', () => {
		const candles = makeSequentialCandles(200);
		const result = runRollingWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout', 3,
		);

		exportRollingSummaryJSON(result, testJsonPath);
		expect(existsSync(testJsonPath)).toBe(true);

		const parsed = JSON.parse(readFileSync(testJsonPath, 'utf-8'));
		expect(parsed.robustness).toBeDefined();
		expect(parsed.robustness.score).toBeDefined();
		expect(parsed.robustness.passRate).toBeDefined();
		expect(parsed.windows).toBeDefined();
		expect(parsed.strategy).toBe('donchian-breakout');

		unlinkSync(testJsonPath);
	});
});
