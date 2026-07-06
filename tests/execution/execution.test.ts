// ============================================================================
// KRIPTOQUANT — Execution Layer Tests (Sprint 12)
// ============================================================================
// Broker, Portfolio, PositionManager, StopRule, Providers birim testleri
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
import { CSVProvider } from '../../src/data/csv-provider.js';
import { ReplayProvider } from '../../src/data/replay-provider.js';
import { AtrStopRule } from '../../src/execution/stop-rule.js';
import { PositionManager } from '../../src/execution/position-manager.js';
import { CSVTradeLogger } from '../../src/execution/trade-logger.js';

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

		expect(fill.commission).toBeCloseTo(10, 4);
		expect(fill.quantity).toBeCloseTo(9990 / (50000 * 1.0005), 6);
	});

	it('should deduct commission from sell', () => {
		const fill = broker.sell(1000, 50000, 1.0);

		expect(fill.commission).toBeCloseTo(49975 * 0.001, 4);
	});
});

describe('PaperBroker & CSVTradeLogger', () => {
	const logPath = 'test-paper-logger-trades.csv';

	it('should produce same fills as SimulatedBroker', () => {
		const sim = new SimulatedBroker(0.10, 0.05);
		const paper = new PaperBroker(0.10, 0.05);

		const simFill = sim.buy(1000, 50000, 10000);
		const paperFill = paper.buy(1000, 50000, 10000);

		expect(paperFill.price).toBe(simFill.price);
		expect(paperFill.quantity).toBe(simFill.quantity);
		expect(paperFill.commission).toBe(simFill.commission);
	});

	it('should log fills to CSV via CSVTradeLogger', () => {
		const logger = new CSVTradeLogger(logPath);
		const paper = new PaperBroker(0.10, 0.05);

		const f1 = paper.buy(1000, 50000, 10000);
		const f2 = paper.sell(2000, 55000, 0.2);

		logger.onFill(f1);
		logger.onFill(f2);
		logger.flush();

		expect(existsSync(logPath)).toBe(true);
		const content = readFileSync(logPath, 'utf-8');
		const lines = content.trim().split('\n');

		expect(lines[0]).toContain('Timestamp');
		expect(lines[0]).toContain('Side');
		expect(lines[1]).toContain('BUY');
		expect(lines[2]).toContain('SELL');

		unlinkSync(logPath);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO & POSITION MANAGER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Portfolio & PositionManager', () => {
	it('should start with correct capital', () => {
		const p = new Portfolio(10000);
		expect(p.getCapital()).toBe(10000);
		expect(p.getInitialCapital()).toBe(10000);
		expect(p.positions.hasOpen()).toBe(false);
	});

	it('should deduct capital on position open', () => {
		const p = new Portfolio(10000);
		const fill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 50, commission: 5 };

		p.positions.open(fill, 5000, 10, 90);
		p.deductCapital(5000);

		expect(p.getCapital()).toBe(5000);
		expect(p.positions.hasOpen()).toBe(true);
		expect(p.positions.getQuantity()).toBe(50);
		expect(p.positions.getStopLossPrice()).toBe(90);
	});

	it('should add capital on position close', () => {
		const p = new Portfolio(10000);
		const buyFill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 50, commission: 5 };
		p.positions.open(buyFill, 5000, 10, 90);
		p.deductCapital(5005); // 5000 + 5 buy commission

		const sellFill: Fill = { timestamp: 2000, side: 'SELL', price: 110, quantity: 50, commission: 5.5 };
		const trade = p.positions.close(sellFill, 'Test close', 'TESTUSDT');
		p.addTrade(trade);
		p.addCapital(50 * 110 - 5.5);

		expect(p.positions.hasOpen()).toBe(false);
		expect(p.getCapital()).toBeCloseTo(10489.5, 2); // 10000 - 5005 + 5494.5 = 10489.5
		expect(trade.pnl).toBeCloseTo(489.5, 2); // 500 - 5.5 - 5 = 489.5
	});

	it('should evaluate stop loss rules', () => {
		const manager = new PositionManager();
		const fill: Fill = { timestamp: 1000, side: 'BUY', price: 100, quantity: 50, commission: 5 };
		manager.open(fill, 5000, 10, 90);

		const rule = new AtrStopRule(2.0);

		// Stop not hit
		const c1: Candle = { openTime: 2000, open: 95, high: 98, low: 92, close: 94, volume: 100, closeTime: 2000 };
		expect(manager.evaluateStopLoss(c1, rule)).toBeNull();

		// Stop hit (low <= 90)
		const c2: Candle = { openTime: 3000, open: 95, high: 98, low: 88, close: 89, volume: 100, closeTime: 3000 };
		const sig1 = manager.evaluateStopLoss(c2, rule);
		expect(sig1).not.toBeNull();
		expect(sig1?.exitPrice).toBe(90);

		// Gap down (open <= 90)
		const c3: Candle = { openTime: 4000, open: 85, high: 88, low: 80, close: 82, volume: 100, closeTime: 4000 };
		const sig2 = manager.evaluateStopLoss(c3, rule);
		expect(sig2?.exitPrice).toBe(85);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Providers', () => {
	it('ReplayProvider should stream candles', async () => {
		const baseCandles = makeTrendingCandles(10);
		const provider = new ReplayProvider(baseCandles, { intervalMs: 0 });

		const history = await provider.getHistory('BTC', '1d');
		expect(history).toHaveLength(10);

		const streamed: Candle[] = [];
		provider.subscribe((c) => streamed.push(c));

		await provider.start();
		expect(streamed).toHaveLength(10);
		expect(streamed[0].openTime).toBe(baseCandles[0].openTime);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION ENGINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Execution Engine', () => {
	it('should produce same result as old backtest (regression)', () => {
		const candles = makeTrendingCandles(60);
		const strategy = createDonchianBreakoutStrategy(20);

		// Wrapper call
		const oldResult = runBacktest(strategy, candles, platformConfig, riskConfig, 'TEST');

		// Direct engine call
		const broker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);
		const newResult = runExecution(candles, strategy, broker, platformConfig, riskConfig, 'TEST');

		expect(newResult.totalReturn).toBe(oldResult.totalReturn);
		expect(newResult.totalTrades).toBe(oldResult.totalTrades);
		expect(newResult.sharpeRatio).toBe(oldResult.sharpeRatio);
		expect(newResult.maxDrawdown).toBe(oldResult.maxDrawdown);
		expect(newResult.winRate).toBe(oldResult.winRate);
	});
});
