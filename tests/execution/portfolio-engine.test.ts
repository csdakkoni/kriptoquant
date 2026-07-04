// ============================================================================
// KRIPTOQUANT — Portfolio Engine Unit Tests (Sprint 18)
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle, Strategy } from '../../src/core/types.js';
import { CSVTimelineProvider } from '../../src/execution/portfolio/timeline-provider.js';
import { EqualWeightAllocation, RiskBudgetAllocation } from '../../src/execution/portfolio/allocation.js';
import { runPortfolioExecution } from '../../src/execution/portfolio/portfolio-engine.js';

// Helper to create mock candle
function createMockCandle(openTime: number, close: number, atr: number = 2.0): Candle {
	return {
		openTime,
		closeTime: openTime + 60000,
		open: close,
		high: close + atr,
		low: close - atr,
		close,
		volume: 1000,
	};
}

describe('Portfolio Engine — Timeline Provider', () => {
	it('should align candles across multiple assets chronologically', () => {
		const btcCandles = [
			createMockCandle(1000, 100),
			createMockCandle(2000, 101),
		];
		const ethCandles = [
			createMockCandle(1000, 10),
			createMockCandle(3000, 11), // eth skips time 2000, has time 3000
		];

		const provider = new CSVTimelineProvider();
		const candlesMap = new Map<string, Candle[]>();
		candlesMap.set('BTCUSDT', btcCandles);
		candlesMap.set('ETHUSDT', ethCandles);

		const timeline = provider.alignCandles(candlesMap);

		expect(timeline).toHaveLength(3);
		expect(timeline[0].timestamp).toBe(1000);
		expect(timeline[0].candles.get('BTCUSDT')).toBe(btcCandles[0]);
		expect(timeline[0].candles.get('ETHUSDT')).toBe(ethCandles[0]);

		expect(timeline[1].timestamp).toBe(2000);
		expect(timeline[1].candles.get('BTCUSDT')).toBe(btcCandles[1]);
		expect(timeline[1].candles.has('ETHUSDT')).toBe(false);

		expect(timeline[2].timestamp).toBe(3000);
		expect(timeline[2].candles.has('BTCUSDT')).toBe(false);
		expect(timeline[2].candles.get('ETHUSDT')).toBe(ethCandles[1]);
	});
});

describe('Portfolio Engine — Allocation Strategies', () => {
	it('should calculate Equal Weight correctly', () => {
		const strategy = new EqualWeightAllocation();
		const size = strategy.allocate('BTCUSDT', 100, 2.0, {
			cash: 10000,
			equity: 10000,
			openPositionsCount: 0,
			maxPositions: 5,
		});
		expect(size).toBe(2000); // 10000 / 5
	});

	it('should calculate ATR Risk Budget correctly and respect available cash/max position size limit', () => {
		// Equity = 10000, risk percent = 1% -> risk amount = 100
		// ATR = 2.0, atrMultiplier = 2.0 -> stop distance = 4.0
		// quantity = 100 / 4.0 = 25 coins
		// nominal size = 25 * 100 (entry price) = 2500 USDT
		const strategy = new RiskBudgetAllocation(1.0, 2.0);
		const size = strategy.allocate('BTCUSDT', 100, 2.0, {
			cash: 10000,
			equity: 10000,
			openPositionsCount: 0,
			maxPositions: 5, // Equal weight slice size cap = 2000
		});
		// Cap of 2000 applies (since 2500 > 10000 / 5)
		expect(size).toBe(2000);

		// With maxPositions = 2 (slice cap = 5000)
		const size2 = strategy.allocate('BTCUSDT', 100, 2.0, {
			cash: 10000,
			equity: 10000,
			openPositionsCount: 0,
			maxPositions: 2,
		});
		expect(size2).toBe(2500); // Capped at nominal risk size
	});
});

describe('Portfolio Engine — Constraint Verification', () => {
	it('should open at most maxPositions concurrent positions when 10 BUY signals occur at the same timestamp', () => {
		const coins = Array.from({ length: 10 }, (_, i) => `COIN_${i}`);
		const candlesMap = new Map<string, Candle[]>();
		const strategies = new Map<string, Strategy>();

		// Setup 10 assets with 1 candle each
		for (const coin of coins) {
			const candles = [createMockCandle(1000, 100)];
			candlesMap.set(coin, candles);

			const mockStrategy: Strategy = {
				name: 'mock',
				warmupPeriod: 0,
				version: '1.0.0',
				evaluate: () => [{ timestamp: 1000, side: 'BUY', price: 100, confidence: 1.0, reason: '' }],
			};
			(mockStrategy as any).indicatorsData = new Map();
			(mockStrategy as any).indicatorsData.set('atr', [2.0]);
			strategies.set(coin, mockStrategy);
		}

		const provider = new CSVTimelineProvider();
		const timeline = provider.alignCandles(candlesMap);

		const result = runPortfolioExecution(
			timeline,
			candlesMap,
			strategies,
			new EqualWeightAllocation(),
			{ initialCapital: 10000, commissionPercent: 0, slippagePercent: 0, defaultInterval: '1m' },
			{ stopLossAtrMultiplier: 2.0 },
			{ maxPositions: 5, preventDoublePosition: true }
		);

		// Must have exactly 5 open positions, so total trades forced closed at backtest end is 5
		expect(result.totalTrades).toBe(5);
		expect(result.trades).toHaveLength(5);
	});

	it('should instantly free up slot in the same tick if a position is stop-lossed', () => {
		// Timeline with two steps:
		// Step 1: open COIN_A (BUY)
		// Step 2: COIN_A is stopped out, COIN_B generates BUY signal.
		// Since COIN_A was stop-lossed at the beginning of Step 2, the slot is freed up instantly.
		const candlesMap = new Map<string, Candle[]>();
		const strategies = new Map<string, Strategy>();

		// COIN_A goes down and gets stop-lossed in step 2 (from 100 to 80, stop at 100 - 2*2 = 96)
		const candlesA = [
			createMockCandle(1000, 100, 2.0),
			createMockCandle(2000, 80, 2.0), // Low is 78, stop hit!
		];
		// COIN_B generates BUY signal in step 2
		const candlesB = [
			createMockCandle(1000, 100, 2.0), // Warmup
			createMockCandle(2000, 100, 2.0), // Signals BUY
		];

		candlesMap.set('COIN_A', candlesA);
		candlesMap.set('COIN_B', candlesB);

		const stratA: Strategy = {
			name: 'mock-a',
			warmupPeriod: 0,
			version: '1.0.0',
			evaluate: () => [{ timestamp: 1000, side: 'BUY', price: 100, confidence: 1.0, reason: '' }],
		};
		(stratA as any).indicatorsData = new Map();
		(stratA as any).indicatorsData.set('atr', [2.0, 2.0]);

		const stratB: Strategy = {
			name: 'mock-b',
			warmupPeriod: 0,
			version: '1.0.0',
			evaluate: () => [{ timestamp: 2000, side: 'BUY', price: 100, confidence: 1.0, reason: '' }],
		};
		(stratB as any).indicatorsData = new Map();
		(stratB as any).indicatorsData.set('atr', [2.0, 2.0]);

		strategies.set('COIN_A', stratA);
		strategies.set('COIN_B', stratB);

		const provider = new CSVTimelineProvider();
		const timeline = provider.alignCandles(candlesMap);

		const result = runPortfolioExecution(
			timeline,
			candlesMap,
			strategies,
			new EqualWeightAllocation(),
			{ initialCapital: 10000, commissionPercent: 0, slippagePercent: 0, defaultInterval: '1d' },
			{ stopLossAtrMultiplier: 2.0 },
			{ maxPositions: 1, preventDoublePosition: true } // Limit is 1!
		);

		// Total trades should be 2:
		// 1. COIN_A stopped out
		// 2. COIN_B opened at 2000 and forced closed at the end
		expect(result.totalTrades).toBe(2);
		expect(result.trades.map((t) => t.asset)).toContain('COIN_A');
		expect(result.trades.map((t) => t.asset)).toContain('COIN_B');
	});

	it('should prevent opening a second position for the same asset', () => {
		const candles = [
			createMockCandle(1000, 100),
			createMockCandle(2000, 101),
		];
		const candlesMap = new Map<string, Candle[]>();
		candlesMap.set('BTCUSDT', candles);

		const strategy: Strategy = {
			name: 'mock',
			warmupPeriod: 0,
			version: '1.0.0',
			evaluate: () => [
				{ timestamp: 1000, side: 'BUY', price: 100, confidence: 1.0, reason: '' },
				{ timestamp: 2000, side: 'BUY', price: 101, confidence: 1.0, reason: '' },
			],
		};
		(strategy as any).indicatorsData = new Map();
		(strategy as any).indicatorsData.set('atr', [2.0, 2.0]);

		const strategies = new Map<string, Strategy>();
		strategies.set('BTCUSDT', strategy);

		const provider = new CSVTimelineProvider();
		const timeline = provider.alignCandles(candlesMap);

		const result = runPortfolioExecution(
			timeline,
			candlesMap,
			strategies,
			new EqualWeightAllocation(),
			{ initialCapital: 10000, commissionPercent: 0, slippagePercent: 0, defaultInterval: '1d' },
			{ stopLossAtrMultiplier: 2.0 },
			{ maxPositions: 5, preventDoublePosition: true }
		);

		// Should only open 1 position, and force close it at end (total trade: 1)
		expect(result.totalTrades).toBe(1);
	});
});
