// ============================================================================
// KRIPTOQUANT — Market Regime Detection Tests (Sprint 15)
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle, Trade } from '../../src/core/types.js';
import type { MarketRegime, RegimeClassifier } from '../../src/research/regime/types.js';
import { DefaultRegimeClassifier } from '../../src/research/regime/classifier.js';
import { analyzeRegimes } from '../../src/research/regime/regime-analyzer.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeMockCandle(ts: number, close: number, high: number = close + 1, low: number = close - 1): Candle {
	return {
		openTime: ts,
		open: close,
		high,
		low,
		close,
		volume: 1000,
		closeTime: ts + 86400000 - 1,
	};
}

function makeMockTrade(entryTs: number, pnlPercent: number, pnl: number): Trade {
	return {
		asset: 'BTCUSDT',
		entryOrder: { timestamp: entryTs, side: 'BUY', price: 100, quantity: 1, value: 100 },
		exitOrder: { timestamp: entryTs + 1000, side: 'SELL', price: 100 + pnlPercent, quantity: 1, value: 100 + pnl },
		positionSize: 100,
		commission: 0,
		grossPnl: pnl,
		pnl,
		pnlPercent,
		holdingPeriod: 1000,
		atrAtEntry: 2.0,
		exitReason: 'Signal',
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regime Classifier', () => {
	it('should classify candles and return exact size array', () => {
		const candles: Candle[] = [];
		for (let i = 0; i < 210; i++) {
			candles.push(makeMockCandle(i * 86400000, 100 + i));
		}

		const classifier = new DefaultRegimeClassifier();
		const regimes = classifier.classify(candles);

		expect(regimes).toHaveLength(210);
		expect(regimes[0].trend).toBe('SIDEWAYS'); // Warmup values should default to Sideways/Low Vol
		expect(regimes[0].volatility).toBe('LOW');
	});
});

describe('Regime Analyzer', () => {
	it('should group trades by regime, calculate coverage, and output correct recommendations', () => {
		// Mock classifier that returns custom regimes
		const mockClassifier: RegimeClassifier = {
			classify(candles) {
				return candles.map((c, i) => {
					if (i < 5) return { trend: 'BULL', volatility: 'HIGH' };
					return { trend: 'SIDEWAYS', volatility: 'LOW' };
				});
			},
		};

		const candles = [
			makeMockCandle(1000, 100),
			makeMockCandle(2000, 101),
			makeMockCandle(3000, 102),
			makeMockCandle(4000, 103),
			makeMockCandle(5000, 104),
			makeMockCandle(6000, 105),
			makeMockCandle(7000, 106),
			makeMockCandle(8000, 107),
			makeMockCandle(9000, 108),
			makeMockCandle(10000, 109),
		];

		// Trades: 3 in BULL_HIGH, 1 in SIDEWAYS_LOW
		const trades = [
			makeMockTrade(1000, 10, 10), // BULL_HIGH, Win
			makeMockTrade(2000, 15, 15), // BULL_HIGH, Win
			makeMockTrade(3000, 5, 5),   // BULL_HIGH, Win -> Total 3 trades, PF = 999 -> ENABLE recommendation
			makeMockTrade(6000, -10, -10), // SIDEWAYS_LOW -> 1 trade -> NEUTRAL recommendation (< 3 trades)
		];

		const report = analyzeRegimes(trades, candles, mockClassifier);
		
		// Coverage: 5 out of 10 candles in BULL_HIGH -> 50%
		// 5 out of 10 in SIDEWAYS_LOW -> 50%
		const bullHigh = report.stats.find((s) => s.regimeKey === 'BULL_HIGH');
		const sidewaysLow = report.stats.find((s) => s.regimeKey === 'SIDEWAYS_LOW');

		expect(bullHigh).toBeDefined();
		expect(bullHigh?.datasetCoveragePercent).toBe(50);
		expect(bullHigh?.tradeCount).toBe(3);
		expect(bullHigh?.winRate).toBe(100);
		expect(bullHigh?.recommendation).toBe('ENABLE');

		expect(sidewaysLow).toBeDefined();
		expect(sidewaysLow?.datasetCoveragePercent).toBe(50);
		expect(sidewaysLow?.tradeCount).toBe(1);
		expect(sidewaysLow?.recommendation).toBe('NEUTRAL');
	});
});
