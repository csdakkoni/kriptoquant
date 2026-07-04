// ============================================================================
// KRIPTOQUANT — Multi-Asset Lab Tests (Sprint 13)
// ============================================================================

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { Candle, PlatformConfig, RiskConfig } from '../../src/core/types.js';
import type { AssetIntervalResult, RobustnessWeights } from '../../src/research/multi-asset/types.js';
import { runMultiAssetResearch } from '../../src/research/multi-asset/runner.js';
import { calculateCrossAssetScore, getRobustnessLabel } from '../../src/research/multi-asset/scoring.js';
import { aggregateResearchResults } from '../../src/research/multi-asset/aggregator.js';
import { exportMultiAssetCSV, exportMultiAssetJSON } from '../../src/research/multi-asset/reporter.js';
import { runRollingWalkForward } from '../../src/research/walkforward/rolling.js';

// ─── Test Data ───────────────────────────────────────────────────────────────

const platformConfig: PlatformConfig = {
	coins: ['BTCUSDT', 'ETHUSDT'],
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

function makeMockWindow(passed: boolean, returnVal: number, sharpe: number = 1.0) {
	return {
		windowIndex: 1,
		bestParams: { strategyName: 'donchian-breakout', donchianPeriod: 10 },
		trainMetrics: {
			totalReturn: 10, sharpeRatio: 1.0, profitFactor: 1.5, maxDrawdown: 5,
			totalTrades: 5, winRate: 50, alpha: 2.0, totalSignals: 10, acceptedSignals: 5,
		},
		testMetrics: {
			totalReturn: returnVal, sharpeRatio: sharpe, profitFactor: returnVal > 0 ? 1.5 : 0.5, maxDrawdown: 5,
			totalTrades: 5, winRate: 50, alpha: 2.0, totalSignals: 10, acceptedSignals: 5,
		},
		generalization: { retention: 80, label: passed ? 'GOOD' : 'FAILED', emoji: '🟡' },
		trainPeriod: { start: '2023-01-01', end: '2023-06-01', startTs: 0, endTs: 1, candleCount: 100 },
		testPeriod: { start: '2023-06-02', end: '2023-09-01', startTs: 2, endTs: 3, candleCount: 50 },
		passed,
	};
}

function makeMockAssetIntervalResult(
	coin: string,
	interval: string,
	passed: boolean,
	testReturn: number,
	sharpe: number = 1.0,
): AssetIntervalResult {
	const windows = [
		makeMockWindow(passed, testReturn, sharpe),
		makeMockWindow(passed, testReturn * 0.9, sharpe * 0.9),
	];
	return {
		coin,
		interval,
		passRate: passed ? 1.0 : 0.0,
		avgTestReturn: testReturn,
		avgSharpe: sharpe,
		avgMaxDrawdown: 5.0,
		passed,
		windows,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-Asset Robustness Score Calculation', () => {
	const testWeights: RobustnessWeights = {
		passRate: 40,
		assetSuccess: 30,
		sharpe: 30,
		drawdownPenalty: 0.5,
	};

	it('should calculate perfect score when all asset-intervals are fully robust', () => {
		const results = [
			makeMockAssetIntervalResult('BTCUSDT', '1d', true, 20.0, 2.0),
			makeMockAssetIntervalResult('ETHUSDT', '1d', true, 20.0, 2.0),
		];

		const score = calculateCrossAssetScore(results, testWeights);
		expect(score).toBeGreaterThanOrEqual(75);
		expect(getRobustnessLabel(score)).toBe('🟢 ROBUST');
	});

	it('should return low score when everything fails', () => {
		const results = [
			makeMockAssetIntervalResult('BTCUSDT', '1d', false, -5.0, -0.5),
			makeMockAssetIntervalResult('ETHUSDT', '1d', false, -10.0, -1.0),
		];

		const score = calculateCrossAssetScore(results, testWeights);
		expect(score).toBeLessThanOrEqual(30);
		expect(getRobustnessLabel(score)).toContain('UNRELIABLE');
	});

	it('should respect custom scoring weights', () => {
		const results = [
			makeMockAssetIntervalResult('BTCUSDT', '1d', true, 20.0, 2.0),
			makeMockAssetIntervalResult('ETHUSDT', '1d', false, -10.0, -1.0),
		];

		// High weight on assetSuccess
		const highAssetSuccessWeights: RobustnessWeights = {
			passRate: 10,
			assetSuccess: 80,
			sharpe: 10,
			drawdownPenalty: 0,
		};

		// 1 out of 2 passed overall -> assetSuccessRatio = 0.5
		// overallPassRate = 0.5
		// Sharpe stability is ~ 1 / (1 + stddev(2.0, -1.0)) = 1 / (1 + 1.5) = 0.4
		// rawScore = 0.5 * 10 + 0.5 * 80 + 0.4 * 10 = 5 + 40 + 4 = 49
		const score = calculateCrossAssetScore(results, highAssetSuccessWeights);
		expect(score).toBeCloseTo(49, 0);
	});
});

describe('Multi-Asset Aggregator', () => {
	it('should aggregate averages and handle empty inputs correctly', () => {
		const results = [
			makeMockAssetIntervalResult('BTCUSDT', '1d', true, 10.0, 1.5),
			makeMockAssetIntervalResult('ETHUSDT', '1d', false, -5.0, -0.5),
		];

		const summary = aggregateResearchResults(results, 'donchian-breakout');
		expect(summary.strategyName).toBe('donchian-breakout');
		expect(summary.avgReturn).toBe(2.5); // (10 + -5) / 2 = 2.5
		expect(summary.avgSharpe).toBe(0.5); // (1.5 + -0.5) / 2 = 0.5
		expect(summary.avgMaxDrawdown).toBe(5.0);
		expect(summary.overallPassRate).toBe(0.5);
		expect(summary.assetSuccessRatio).toBe(0.5);
	});
});

describe('Multi-Asset Exporters', () => {
	const csvPath = 'test-multi-asset.csv';
	const jsonPath = 'test-multi-asset.json';

	it('should export valid CSV and JSON', () => {
		const results = [
			makeMockAssetIntervalResult('BTCUSDT', '1d', true, 10.0, 1.5),
		];
		const summary = aggregateResearchResults(results, 'donchian-breakout');

		exportMultiAssetCSV(summary, csvPath);
		expect(existsSync(csvPath)).toBe(true);

		const csvContent = readFileSync(csvPath, 'utf-8');
		expect(csvContent).toContain('Coin,Interval,PassRate');
		expect(csvContent).toContain('BTCUSDT,1d,2/2');

		exportMultiAssetJSON(summary, jsonPath);
		expect(existsSync(jsonPath)).toBe(true);

		const jsonContent = JSON.parse(readFileSync(jsonPath, 'utf-8'));
		expect(jsonContent.robustnessScore).toBeDefined();
		expect(jsonContent.results).toHaveLength(1);

		unlinkSync(csvPath);
		unlinkSync(jsonPath);
	});
});

describe('Multi-Asset Runner & Regression', () => {
	it('should run multi asset walk forward orchestrator correctly', async () => {
		const candles = makeSequentialCandles(120);

		// Pre-populate mock historical data inside the store directory
		// to prevent API requests during tests
		const { saveCandles } = await import('../../src/data/store.js');
		saveCandles('MOCKCOIN1', '1d', candles);
		saveCandles('MOCKCOIN2', '1d', candles);

		const options = {
			coins: ['MOCKCOIN1', 'MOCKCOIN2'],
			intervals: ['1d'],
			strategyName: 'donchian-breakout',
			numWindows: 3,
			trainRatio: 0.70,
		};

		const results = await runMultiAssetResearch(options, platformConfig, riskConfig);
		expect(results).toHaveLength(2);
		expect(results[0].coin).toBe('MOCKCOIN1');
		expect(results[1].coin).toBe('MOCKCOIN2');
		expect(results[0].windows).toHaveLength(3);

		// Clean up files
		const fs = await import('node:fs');
		const path = await import('node:path');
		const rawDir = path.join(import.meta.dirname, '../../data/raw');
		const file1 = path.join(rawDir, 'MOCKCOIN1_1d.json');
		const file2 = path.join(rawDir, 'MOCKCOIN2_1d.json');
		if (fs.existsSync(file1)) fs.unlinkSync(file1);
		if (fs.existsSync(file2)) fs.unlinkSync(file2);
	});

	it('should match single-asset Rolling Walk-Forward result (regression)', async () => {
		const candles = makeSequentialCandles(120);
		const { saveCandles } = await import('../../src/data/store.js');
		saveCandles('BTCUSDT', '1d', candles);

		// Single-asset Rolling WF
		const singleResult = runRollingWalkForward(
			candles,
			platformConfig,
			riskConfig,
			'BTCUSDT',
			'1d',
			'donchian-breakout',
			3,
			0.70,
		);

		// Multi-asset runner
		const multiResults = await runMultiAssetResearch(
			{ coins: ['BTCUSDT'], intervals: ['1d'], strategyName: 'donchian-breakout', numWindows: 3, trainRatio: 0.70 },
			platformConfig,
			riskConfig,
		);

		expect(multiResults).toHaveLength(1);
		const multiRes = multiResults[0];

		// Check matching window metrics
		expect(multiRes.windows).toHaveLength(singleResult.windows.length);
		for (let i = 0; i < multiRes.windows.length; i++) {
			expect(multiRes.windows[i].passed).toBe(singleResult.windows[i].passed);
			expect(multiRes.windows[i].testMetrics.totalReturn).toBe(singleResult.windows[i].testMetrics.totalReturn);
			expect(multiRes.windows[i].bestParams).toEqual(singleResult.windows[i].bestParams);
		}

		// Clean up
		const fs = await import('node:fs');
		const path = await import('node:path');
		const rawFile = path.join(import.meta.dirname, '../../data/raw/BTCUSDT_1d.json');
		if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
	});
});
