// ============================================================================
// KRIPTOQUANT — Execution Layer Tests (Sprint 11)
// ============================================================================
// Broker, Portfolio, Execution Engine birim testleri
// ============================================================================

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { Candle, PlatformConfig, RiskConfig } from '../../src/core/types.js';
import type { Broker, Fill } from '../../src/execution/broker.js';
import { SimulatedBroker } from '../../src/execution/simulated-broker.js';
import { PaperBroker } from '../../src/execution/paper-broker.js';
import { Portfolio } from '../../src/execution/portfolio.js';
import { runExecution } from '../../src/execution/engine.js';
import { createDonchianBreakoutStrategy } from '../../src/research/strategies/donchian-breakout/index.js';
import { runBacktest } from '../../src/research/backtester.js';

// ─── Test Config ─────────────────────────────────────────────────────────────

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

function makeTrendingCandles(count: number): Candle[] {
	return Array.from({ length: count }, (_, i) => {
		const base = 100 + i * 3;
		return {
			openTime: i * 86400000,
			open: base,
			high: base + 8,
			low: base - 3,
			close: base + 5,
			volume: 1000 + i * 50,
			closeTime: (i + 1) * 86400000 - 1,
		};
	});
}

// ═══════════════════════════════════════════════════════════════════════════════
// BROKER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('SimulatedBroker', () => {
	const broker = new SimulatedBroker(0.10, 0.05);

	it('should apply buy slippage (price goes UP)', () => {
		const fill = broker.buy(1000, 50000, 10000);

		expect(fill.side).toBe('BUY');
		expect(fill.price).toBeGreaterThan(50000);
		expect(fill.price).toBeCloseTo(50000 * 1.0005, 4);
	});

	it('should apply sell slippage (price goes DOWN)', () => {
		const fill = broker.sell(1000, 50000, 1.0);

		expect(fill.side).toBe('SELL');
		expect(fill.price).toBeLessThan(50000);
		expect(fill.price).toBeCloseTo(50000 * 0.9995, 4);
	});

	it('should deduct commission from buy', () => {
		const fill = broker.buy(1000, 50000, 10000);

		// Commission = 10000 * 0.001 = 10
		expect(fill.commission).toBeCloseTo(10, 4);
		// Quantity = (10000 - 10) / (50000 * 1.0005) = 9990 / 50025 ≈ 0.1997
		expect(fill.quantity).toBeCloseTo(9990 / (50000 * 1.0005), 6);
	});

	it('should deduct commission from sell', () => {
		const fill = broker.sell(1000, 50000, 1.0);

		// grossValue = 1.0 * 49975 = 49975
		// commission = 49975 * 0.001 = 49.975
		expect(fill.commission).toBeCloseTo(49975 * 0.001, 4);
	});

	it('should be deterministic', () => {
		const f1 = broker.buy(1000, 50000, 10000);
		const f2 = broker.buy(1000, 50000, 10000);

		expect(f1.price).toBe(f2.price);
		expect(f1.quantity).toBe(f2.quantity);
		expect(f1.commission).toBe(f2.commission);
	});

	it('should have no side effects', () => {
		// Broker has no state — calling buy/sell doesn't affect future calls
		broker.buy(1000, 50000, 10000);
		broker.sell(2000, 60000, 1.0);

		const fill = broker.buy(3000, 50000, 10000);
		expect(fill.price).toBeCloseTo(50000 * 1.0005, 4);
	});
});

describe('PaperBroker', () => {
	const logPath = 'test-paper-trades.csv';

	it('should produce same fills as SimulatedBroker', () => {
		const sim = new SimulatedBroker(0.10, 0.05);
		const paper = new PaperBroker(0.10, 0.05, logPath);

		const simFill = sim.buy(1000, 50000, 10000);
		const paperFill = paper.buy(1000, 50000, 10000);

		expect(paperFill.price).toBe(simFill.price);
		expect(paperFill.quantity).toBe(simFill.quantity);
		expect(paperFill.commission).toBe(simFill.commission);

		// Cleanup
		if (existsSync(logPath)) unlinkSync(logPath);
	});

	it('should log fills to CSV', () => {
		const paper = new PaperBroker(0.10, 0.05, logPath);

		paper.buy(1000, 50000, 10000);
		paper.sell(2000, 55000, 0.2);

		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, 'utf-8');
		const lines = content.trim().split('\n');

		expect(lines[0]).toContain('Timestamp');
		expect(lines[0]).toContain('Side');
		expect(lines[1]).toContain('BUY');
		expect(lines[2]).toContain('SELL');

		unlinkSync(logPath);
	});

	it('should track fills internally', () => {
		const paper = new PaperBroker(0.10, 0.05, logPath);

		paper.buy(1000, 50000, 10000);
		paper.sell(2000, 55000, 0.2);

		expect(paper.getFills()).toHaveLength(2);

		if (existsSync(logPath)) unlinkSync(logPath);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Portfolio', () => {
	it('should start with correct capital', () => {
		const p = new Portfolio(10000);
		expect(p.getCapital()).toBe(10000);
		expect(p.getInitialCapital()).toBe(10000);
		expect(p.hasOpenPosition()).toBe(false);
	});

	it('should deduct capital on position open', () => {
		const p = new Portfolio(10000);
		const fill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 50, commission: 5 };

		p.openPosition(fill, 5000, 10, 90);

		expect(p.getCapital()).toBe(5000); // 10000 - 5000
		expect(p.hasOpenPosition()).toBe(true);
		expect(p.getPositionQuantity()).toBe(50);
		expect(p.getStopLossPrice()).toBe(90);
	});

	it('should add capital on position close', () => {
		const p = new Portfolio(10000);
		const buyFill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 50, commission: 5 };
		p.openPosition(buyFill, 5000, 10, 90);

		const sellFill: Fill = { timestamp: 2000, side: 'SELL', price: 110, quantity: 50, commission: 5.5 };
		const trade = p.closePosition(sellFill, 'Test close', 'TESTUSDT');

		expect(p.hasOpenPosition()).toBe(false);
		// Capital: 5000 (remaining) + (50 * 110 - 5.5) = 5000 + 5494.5 = 10494.5
		expect(p.getCapital()).toBeCloseTo(10494.5, 2);
		expect(trade.pnl).toBeCloseTo(494.5, 2);
	});

	it('should track trades', () => {
		const p = new Portfolio(10000);
		const buyFill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 50, commission: 5 };
		p.openPosition(buyFill, 5000, 10, 90);

		const sellFill: Fill = { timestamp: 2000, side: 'SELL', price: 110, quantity: 50, commission: 5.5 };
		p.closePosition(sellFill, 'Test', 'TEST');

		expect(p.getTrades()).toHaveLength(1);
		expect(p.getTrades()[0].exitReason).toBe('Test');
	});

	it('should record equity curve', () => {
		const p = new Portfolio(10000);
		p.recordEquityPoint(1000, 100);

		expect(p.getEquityCurve()).toHaveLength(1);
		expect(p.getEquityCurve()[0].equity).toBe(10000);
	});

	it('should track drawdown', () => {
		const p = new Portfolio(10000);
		const buyFill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 90, commission: 5 };
		p.openPosition(buyFill, 9000, 10, 80);

		// Price drops → equity drops
		p.recordEquityPoint(2000, 80); // equity = 1000 + 90*80 = 8200 → DD from 10000
		expect(p.getMaxDrawdown()).toBeGreaterThan(0);
	});

	it('should reset daily PnL on new day', () => {
		const p = new Portfolio(10000);
		p.updateDay(0);
		expect(p.getDailyPnl()).toBe(0);

		// Next day
		p.updateDay(86400000);
		expect(p.getDailyPnl()).toBe(0);
	});

	it('should throw on close without position', () => {
		const p = new Portfolio(10000);
		const fill: Fill = { timestamp: 1000, side: 'SELL', price: 100, quantity: 50, commission: 5 };
		expect(() => p.closePosition(fill, 'Test', 'TEST')).toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION ENGINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Execution Engine', () => {
	it('should produce same result as old backtest (regression)', () => {
		const candles = makeTrendingCandles(60);
		const strategy = createDonchianBreakoutStrategy(20);

		// Old way (through wrapper)
		const oldResult = runBacktest(strategy, candles, platformConfig, riskConfig, 'TEST');

		// New way (direct engine call)
		const broker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);
		const newResult = runExecution(candles, strategy, broker, platformConfig, riskConfig, 'TEST');

		// Same results
		expect(newResult.totalReturn).toBe(oldResult.totalReturn);
		expect(newResult.totalTrades).toBe(oldResult.totalTrades);
		expect(newResult.sharpeRatio).toBe(oldResult.sharpeRatio);
		expect(newResult.maxDrawdown).toBe(oldResult.maxDrawdown);
		expect(newResult.winRate).toBe(oldResult.winRate);
	});

	it('should work with PaperBroker and produce same fills', () => {
		const candles = makeTrendingCandles(60);
		const strategy = createDonchianBreakoutStrategy(20);
		const logPath = 'test-engine-paper.csv';

		const simBroker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);
		const paperBroker = new PaperBroker(platformConfig.commissionPercent, platformConfig.slippagePercent, logPath);

		const simResult = runExecution(candles, strategy, simBroker, platformConfig, riskConfig, 'TEST');
		const paperResult = runExecution(candles, strategy, paperBroker, platformConfig, riskConfig, 'TEST');

		expect(paperResult.totalReturn).toBe(simResult.totalReturn);
		expect(paperResult.totalTrades).toBe(simResult.totalTrades);

		if (existsSync(logPath)) unlinkSync(logPath);
	});

	it('should accept any Broker implementation', () => {
		// Custom broker that always fills at exact price (no slippage, no commission)
		const perfectBroker: Broker = {
			buy(ts, price, usdtAmount) {
				return { timestamp: ts, side: 'BUY', price, quantity: usdtAmount / price, commission: 0 };
			},
			sell(ts, price, quantity) {
				return { timestamp: ts, side: 'SELL', price, quantity, commission: 0 };
			},
		};

		const candles = makeTrendingCandles(60);
		const strategy = createDonchianBreakoutStrategy(20);
		const result = runExecution(candles, strategy, perfectBroker, platformConfig, riskConfig, 'TEST');

		expect(typeof result.totalReturn).toBe('number');
		expect(typeof result.totalTrades).toBe('number');
	});
});
