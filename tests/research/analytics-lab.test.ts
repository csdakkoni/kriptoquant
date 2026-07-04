// ============================================================================
// KRIPTOQUANT — Trade Analytics Lab Tests (Sprint 14)
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Trade, EquityPoint, Candle } from '../../src/core/types.js';
import { calculateTradeMetrics } from '../../src/research/analytics/trade-metrics.js';
import { calculateEquityMetrics } from '../../src/research/analytics/equity-metrics.js';
import { buildAnalyticsSummary } from '../../src/research/analytics/summary.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeMockTrade(pnl: number, pnlPercent: number, holdingPeriod: number, mae: number, mfe: number, positionSize: number = 1000): Trade {
	return {
		asset: 'BTCUSDT',
		entryOrder: { timestamp: 0, side: 'BUY', price: 100, quantity: 10, value: positionSize },
		exitOrder: { timestamp: holdingPeriod, side: 'SELL', price: 100 + pnlPercent, quantity: 10, value: positionSize + pnl },
		positionSize,
		commission: 2.0,
		grossPnl: pnl + 2.0,
		pnl,
		pnlPercent,
		holdingPeriod,
		atrAtEntry: 2.0,
		exitReason: 'Test exit',
		highestPrice: 100 + mfe,
		lowestPrice: 100 + mae,
		mae,
		mfe,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Trade Metrics Calculations', () => {
	it('should calculate expectancies and flag insufficient samples correctly', () => {
		const trades = [
			makeMockTrade(100, 10, 3600000, -2, 12),
			makeMockTrade(-50, -5, 3600000, -8, 2),
		];

		const res = calculateTradeMetrics(trades);
		// expectancyUsdt = 0.5 * 100 - 0.5 * 50 = 25
		expect(res.expectancyUsdt).toBe(25);
		// expectancyPercent = 0.5 * 10 - 0.5 * 5 = 2.5
		expect(res.expectancyPercent).toBe(2.5);
		// Expectancy R uses risk = atrAtEntry * 2 = 4.
		// winR = 10 / 4 = 2.5
		// lossR = -5 / 4 = -1.25
		// expectancyR = 0.5 * 2.5 - 0.5 * 1.25 = 0.625 -> 0.63
		expect(res.expectancyR).toBe(0.63);

		// Flag warning if N < 30
		expect(res.sqn).toContain('Insufficient');
		expect(res.kelly).toContain('Insufficient');
	});

	it('should compute SQN and Kelly when N >= 30', () => {
		const trades: Trade[] = [];
		for (let i = 0; i < 20; i++) {
			trades.push(makeMockTrade(100, 10, 3600000, -1, 12)); // Wins
		}
		for (let i = 0; i < 15; i++) {
			trades.push(makeMockTrade(-50, -5, 3600000, -6, 1)); // Losses
		}

		const res = calculateTradeMetrics(trades);
		expect(typeof res.sqn).toBe('number');
		expect(typeof res.kelly).toBe('number');
		expect(res.sqn).toBeGreaterThan(0);
	});
});

describe('Equity Metrics Calculations', () => {
	const mockEquityCurve: EquityPoint[] = [
		{ timestamp: 0, equity: 10000, drawdownPercent: 0, returnPercent: 0 },
		{ timestamp: 1, equity: 9500, drawdownPercent: 5, returnPercent: -5 },
		{ timestamp: 2, equity: 9000, drawdownPercent: 10, returnPercent: -10 },
		{ timestamp: 3, equity: 10500, drawdownPercent: 0, returnPercent: 5 },
	];

	const mockCandles: Candle[] = [
		{ openTime: 0, open: 100, high: 105, low: 95, close: 100, volume: 100, closeTime: 10 },
		{ openTime: 11, open: 100, high: 105, low: 95, close: 100, volume: 100, closeTime: 20 },
	];

	it('should calculate UI and recovery ratios correctly', () => {
		const trades = [makeMockTrade(500, 5, 10, -2, 8)];
		const res = calculateEquityMetrics(
			mockEquityCurve,
			trades,
			mockCandles,
			10000,
			10500,
			10,
		);

		// Ulcer Index: drawdowns: [0, 5, 10, 0].
		// sumSq = 0 + 25 + 100 + 0 = 125
		// UI = sqrt(125 / 4) = sqrt(31.25) ≈ 5.59
		expect(res.ulcerIndex).toBeCloseTo(5.59, 2);

		// MAR Ratio: totalReturn = 5%, maxDrawdown = 10%
		// MAR = 5 / 10 = 0.50
		expect(res.marRatio).toBe(0.5);

		// Recovery Factor: NetProfit = 500. MaxDrawdown nominal = 10000 * 0.10 = 1000.
		// Recovery = 500 / 1000 = 0.50
		expect(res.recoveryFactor).toBe(0.5);

		// Gain/Pain: totalWins = 500, totalLosses = 0 -> Infinity -> 999
		expect(res.gainPainRatio).toBe(999);
	});
});

describe('Summary Integrator', () => {
	it('should build summary with proper schema and distribution data', () => {
		const trades = [
			makeMockTrade(100, 10, 3600000, -2, 12),
		];
		const curve = [{ timestamp: 0, equity: 10000, drawdownPercent: 0, returnPercent: 0 }];
		const candles = [{ openTime: 0, open: 100, high: 105, low: 95, close: 100, volume: 100, closeTime: 10 }];

		const summary = buildAnalyticsSummary(curve, trades, candles, 10000, 10100, 2);
		expect(summary.expectancyUsdt).toBeDefined();
		expect(summary.ulcerIndex).toBeDefined();
		expect(summary.distributions.returns).toEqual([10]);
		expect(summary.distributions.durations).toEqual([1]); // 3600000 ms / 3600000 = 1 hour
	});
});
