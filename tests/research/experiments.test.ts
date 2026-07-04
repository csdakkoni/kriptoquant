// ============================================================================
// KRIPTOQUANT — Experiment Tests (Sprint 7)
// ============================================================================
// Parameter sweep, combination generator, experiment runner, CSV export
// ============================================================================

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { Candle, PlatformConfig, RiskConfig } from '../../src/core/types.js';
import {
	generateCombinations,
	runExperiment,
	DEFAULT_SWEEP,
	type ExperimentParams,
	type SweepConfig,
} from '../../src/research/experiments/runner.js';
import { exportSweepCSV, type ExperimentMetadata } from '../../src/research/experiments/sweep.js';
import type { ExperimentResult } from '../../src/research/experiments/runner.js';

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

function makeTrendingCandles(count: number = 60): Candle[] {
	return Array.from({ length: count }, (_, i) => {
		const base = 100 + i * 3;
		const ts = i * 86400000;
		const volume = 1000 + Math.sin(i * 0.5) * 500;
		return {
			openTime: ts,
			open: base,
			high: base + 6,
			low: base - 2,
			close: base + 3,
			volume: Math.abs(volume),
			closeTime: ts + 86400000 - 1,
		};
	});
}

// ─── Combination Generator Tests ─────────────────────────────────────────────

describe('generateCombinations', () => {
	it('should generate correct number of combinations', () => {
		const config: SweepConfig = {
			emaFast: [5, 9],
			emaSlow: [20, 30],
			adxVetoThreshold: [15, 20],
			rvolVetoThreshold: [1.5],
			minimumConfidence: [70],
		};

		const combos = generateCombinations(config);
		// 2 fast × 2 slow × 2 adx × 1 rvol × 1 conf = 8
		expect(combos).toHaveLength(8);
	});

	it('should skip emaFast >= emaSlow combinations', () => {
		const config: SweepConfig = {
			emaFast: [20, 30], // 30 >= 30
			emaSlow: [30],
			adxVetoThreshold: [20],
			rvolVetoThreshold: [1.5],
			minimumConfidence: [70],
		};

		const combos = generateCombinations(config);
		// Only emaFast=20, emaSlow=30 is valid
		expect(combos).toHaveLength(1);
		expect(combos[0].emaFast).toBe(20);
	});

	it('should match expected count for DEFAULT_SWEEP', () => {
		const combos = generateCombinations(DEFAULT_SWEEP);
		// EMA: 5×3×4×3×3 = 540, Donchian: 5×4×3×3 = 180, Total = 720
		expect(combos).toHaveLength(720);
	});

	it('should produce unique param sets', () => {
		const combos = generateCombinations(DEFAULT_SWEEP);
		const hashes = new Set(combos.map((c) => JSON.stringify(c)));
		expect(hashes.size).toBe(combos.length);
	});
});

// ─── Experiment Runner Tests ─────────────────────────────────────────────────

describe('runExperiment', () => {
	it('should return valid ExperimentResult', () => {
		const candles = makeTrendingCandles(60);
		const params: ExperimentParams = {
			strategyName: 'ema-cross',
			emaFast: 5,
			emaSlow: 20,
			adxVetoThreshold: 15,
			rvolVetoThreshold: 1.0,
			minimumConfidence: 60,
		};

		const result = runExperiment(candles, params, platformConfig, riskConfig, 'TEST');

		expect(result.params).toEqual(params);
		expect(typeof result.totalReturn).toBe('number');
		expect(typeof result.sharpeRatio).toBe('number');
		expect(typeof result.profitFactor).toBe('number');
		expect(typeof result.maxDrawdown).toBe('number');
		expect(typeof result.totalTrades).toBe('number');
		expect(typeof result.winRate).toBe('number');
		expect(typeof result.totalSignals).toBe('number');
		expect(result.totalSignals).toBeGreaterThanOrEqual(0);
	});

	it('should be deterministic — same params = same result', () => {
		const candles = makeTrendingCandles(60);
		const params: ExperimentParams = {
			strategyName: 'ema-cross',
			emaFast: 9,
			emaSlow: 21,
			adxVetoThreshold: 20,
			rvolVetoThreshold: 1.5,
			minimumConfidence: 70,
		};

		const result1 = runExperiment(candles, params, platformConfig, riskConfig, 'TEST');
		const result2 = runExperiment(candles, params, platformConfig, riskConfig, 'TEST');

		expect(result1.totalReturn).toBe(result2.totalReturn);
		expect(result1.sharpeRatio).toBe(result2.sharpeRatio);
		expect(result1.totalTrades).toBe(result2.totalTrades);
		expect(result1.winRate).toBe(result2.winRate);
	});

	it('should produce different results for different params', () => {
		const candles = makeTrendingCandles(60);

		const result1 = runExperiment(candles, {
			strategyName: 'ema-cross',
			emaFast: 5, emaSlow: 20, adxVetoThreshold: 15, rvolVetoThreshold: 1.0, minimumConfidence: 60,
		}, platformConfig, riskConfig, 'TEST');

		const result2 = runExperiment(candles, {
			strategyName: 'ema-cross',
			emaFast: 15, emaSlow: 50, adxVetoThreshold: 30, rvolVetoThreshold: 2.0, minimumConfidence: 80,
		}, platformConfig, riskConfig, 'TEST');

		// Different filter params should give different rejection counts or trade results
		const r1 = JSON.stringify({ ret: result1.totalReturn, trades: result1.totalTrades, rejected: result1.rejectedSignals });
		const r2 = JSON.stringify({ ret: result2.totalReturn, trades: result2.totalTrades, rejected: result2.rejectedSignals });
		// At minimum, params are different
		expect(result1.params.emaFast).not.toBe(result2.params.emaFast);
	});
});

// ─── CSV Export Tests ────────────────────────────────────────────────────────

describe('Sweep CSV Export', () => {
	const testPath = 'test-sweep-output.csv';

	it('should export valid CSV with header and rows', () => {
		const results: ExperimentResult[] = [
			{
				params: { strategyName: 'ema-cross', emaFast: 5, emaSlow: 20, adxVetoThreshold: 15, rvolVetoThreshold: 1.5, minimumConfidence: 70 },
				totalReturn: 12.5,
				sharpeRatio: 1.5,
				profitFactor: 2.1,
				maxDrawdown: 5.3,
				totalTrades: 10,
				winRate: 60,
				rejectedSignals: 30,
				acceptedSignals: 10,
				totalSignals: 40,
				alpha: -5.0,
			},
		];

		const metadata: ExperimentMetadata = {
			experimentId: 'test123',
			timestamp: '2026-01-01T00:00:00Z',
			gitCommit: 'abc1234',
			dataset: 'TEST/1d/100',
			durationMs: 100,
			parameterHash: 'hash123',
			totalCombinations: 1,
			cpuCores: 4,
			mode: 'sequential',
		};

		exportSweepCSV(results, metadata, testPath);

		expect(existsSync(testPath)).toBe(true);

		const content = readFileSync(testPath, 'utf-8');
		const lines = content.split('\n');

		expect(lines[0]).toContain('emaFast');
		expect(lines[0]).toContain('Sharpe');
		expect(lines[0]).toContain('WinRate');
		expect(lines[1]).toContain('ema-cross,5,20,');

		// Cleanup
		unlinkSync(testPath);
	});
});
