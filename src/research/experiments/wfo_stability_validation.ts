import { runBacktest } from '../backtester.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import type { Candle, PlatformConfig, RiskConfig } from '../../../core/types.js';
import { getCandles } from '../../data/binance-client.js';
import { runWalkForward, printWalkForwardReport } from '../walkforward/walkforward.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmaCrossStrategy } from '../strategies/ema-cross/index.js';
import { createSmaCrossStrategy } from '../strategies/sma-cross/index.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';

// ─── Strategy Builder Helper ──────────────────────────────────────────────────
function buildStrategy(type: string, params: any, candles: Candle[]) {
	switch (type) {
		case 'ema-cross':
			return createEmaCrossStrategy(params.fast, params.slow);
		case 'sma-cross':
			return createSmaCrossStrategy(params.fast, params.slow);
		case 'donchian-breakout':
			return createDonchianBreakoutStrategy(params.period);
		default:
			throw new Error(`Unknown strategy type: ${type}`);
	}
}

async function run() {
	const platformConfig: PlatformConfig = {
		initialCapital: 10000,
		commissionPercent: 0.10,
		slippagePercent: 0.05
	};

	const rawDefaults = {
		strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
		filters: { adxPeriod: 14, adxVetoThreshold: 25, rvolLookback: 20, rvolVetoThreshold: 2.0 }, // Strict filter
		confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: 80 }
	};

	const startTime = new Date('2022-01-01T00:00:00Z').getTime();
	const endTime = new Date('2026-07-06T23:59:59Z').getTime();

	// Load candles for ETHUSDT and NEARUSDT
	console.log("[Validation Engine] Loading historical data (2022-2026)...");
	const ethCandles = await getCandles('ETHUSDT', '4h', startTime, endTime);
	const nearCandles = await getCandles('NEARUSDT', '4h', startTime, endTime);
	console.log(`Loaded: ETH (${ethCandles.length} candles), NEAR (${nearCandles.length} candles).`);

	// ─── TEST 1: Parameter Stability Plateaus (Full Period 2022-2026) ──────────
	console.log("\n[Test 1] Running Parameter Stability Plateau Sweep (4.5 Years)...");
	
	// ETH Donchian Neighborhood
	const ethPeriods = [48, 49, 50, 51, 52];
	const ethRisk: RiskConfig = { maxPositionPercent: 100, maxDailyLossPercent: 100, maxOrderValue: 10000, stopLossPercent: 0.03, takeProfitPercent: 0.10, stopLossAtrMultiplier: 1.5 };
	const ethPlateau = [];

	console.log("\n📈 ETHUSDT Donchian Neighborhood Results (SL: 3%, TP: 10%, ATR: 1.5):");
	console.log("─".repeat(80));
	for (const period of ethPeriods) {
		const strategy = buildStrategy('donchian-breakout', { period }, ethCandles);
		const res = runBacktest(strategy, ethCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
		ethPlateau.push({ period, return: res.totalReturn, sharpe: res.sharpeRatio, trades: res.totalTrades });
		console.log(`  Donchian-${period} | Return: ${res.totalReturn > 0 ? '+' : ''}${res.totalReturn.toFixed(2)}% | Sharpe: ${res.sharpeRatio.toFixed(2)} | Trades: ${res.totalTrades} (WR: ${res.winRate.toFixed(1)}%)`);
	}

	// NEAR Donchian Neighborhood
	const nearPeriods = [18, 19, 20, 21, 22];
	const nearRisk: RiskConfig = { maxPositionPercent: 100, maxDailyLossPercent: 100, maxOrderValue: 10000, stopLossPercent: 0.05, takeProfitPercent: 0.10, stopLossAtrMultiplier: 1.5 };
	const nearPlateau = [];

	console.log("\n📈 NEARUSDT Donchian Neighborhood Results (SL: 5%, TP: 10%, ATR: 1.5):");
	console.log("─".repeat(80));
	for (const period of nearPeriods) {
		const strategy = buildStrategy('donchian-breakout', { period }, nearCandles);
		const res = runBacktest(strategy, nearCandles, platformConfig, nearRisk, 'NEARUSDT', rawDefaults);
		nearPlateau.push({ period, return: res.totalReturn, sharpe: res.sharpeRatio, trades: res.totalTrades });
		console.log(`  Donchian-${period} | Return: ${res.totalReturn > 0 ? '+' : ''}${res.totalReturn.toFixed(2)}% | Sharpe: ${res.sharpeRatio.toFixed(2)} | Trades: ${res.totalTrades} (WR: ${res.winRate.toFixed(1)}%)`);
	}

	// ─── TEST 2: In-Sample vs. Chronological Out-of-Sample (OOS) ──────────────
	console.log("\n[Test 2] Running In-Sample vs. Out-of-Sample Chronological Splits...");
	
	const isStart = new Date('2022-01-01T00:00:00Z').getTime();
	const isEnd = new Date('2024-12-31T23:59:59Z').getTime();
	const oosStart = new Date('2025-01-01T00:00:00Z').getTime();
	const oosEnd = new Date('2026-07-06T23:59:59Z').getTime();

	// ETHIS and ETH OOS
	const ethISCandles = ethCandles.filter(c => c.openTime >= isStart && c.openTime <= isEnd);
	const ethOOSCandles = ethCandles.filter(c => c.openTime >= oosStart && c.openTime <= oosEnd);
	const ethISStrategy = buildStrategy('donchian-breakout', { period: 50 }, ethISCandles);
	const ethOOSStrategy = buildStrategy('donchian-breakout', { period: 50 }, ethOOSCandles);

	const ethISRes = runBacktest(ethISStrategy, ethISCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
	const ethOOSRes = runBacktest(ethOOSStrategy, ethOOSCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);

	// NEAR IS and NEAR OOS
	const nearISCandles = nearCandles.filter(c => c.openTime >= isStart && c.openTime <= isEnd);
	const nearOOSCandles = nearCandles.filter(c => c.openTime >= oosStart && c.openTime <= oosEnd);
	const nearISStrategy = buildStrategy('donchian-breakout', { period: 20 }, nearISCandles);
	const nearOOSStrategy = buildStrategy('donchian-breakout', { period: 20 }, nearOOSCandles);

	const nearISRes = runBacktest(nearISStrategy, nearISCandles, platformConfig, nearRisk, 'NEARUSDT', rawDefaults);
	const nearOOSRes = runBacktest(nearOOSStrategy, nearOOSCandles, platformConfig, nearRisk, 'NEARUSDT', rawDefaults);

	console.log("\n📅 IN-SAMPLE vs. OUT-OF-SAMPLE RESULTS:");
	console.log("═".repeat(80));
	console.log("  ETHUSDT Donchian-50:");
	console.log(`    In-Sample  (2022-2024): Return: +${ethISRes.totalReturn.toFixed(2)}% | Sharpe: ${ethISRes.sharpeRatio.toFixed(2)} | Trades: ${ethISRes.totalTrades} (WR: ${ethISRes.winRate.toFixed(1)}%)`);
	console.log(`    Out-of-Sample (25-26) : Return: +${ethOOSRes.totalReturn.toFixed(2)}% | Sharpe: ${ethOOSRes.sharpeRatio.toFixed(2)} | Trades: ${ethOOSRes.totalTrades} (WR: ${ethOOSRes.winRate.toFixed(1)}%)`);
	console.log(`    Generalization Ratio  : ${((ethOOSRes.totalReturn / (ethISRes.totalReturn || 1)) * 100).toFixed(1)}%`);
	
	console.log("\n  NEARUSDT Donchian-20:");
	console.log(`    In-Sample  (2022-2024): Return: +${nearISRes.totalReturn.toFixed(2)}% | Sharpe: ${nearISRes.sharpeRatio.toFixed(2)} | Trades: ${nearISRes.totalTrades} (WR: ${nearISRes.winRate.toFixed(1)}%)`);
	console.log(`    Out-of-Sample (25-26) : Return: +${nearOOSRes.totalReturn.toFixed(2)}% | Sharpe: ${nearOOSRes.sharpeRatio.toFixed(2)} | Trades: ${nearOOSRes.totalTrades} (WR: ${nearOOSRes.winRate.toFixed(1)}%)`);
	console.log(`    Generalization Ratio  : ${((nearOOSRes.totalReturn / (nearISRes.totalReturn || 1)) * 100).toFixed(1)}%`);

	// ─── TEST 3: Walk-Forward Validation (WFO) ─────────────────────────────────
	console.log("\n[Test 3] Running Walk-Forward Optimization (WFO) Engine...");
	
	// WFO on ETHUSDT Donchian
	const ethWfo = runWalkForward(ethCandles, platformConfig, ethRisk, 'ETHUSDT', '4h', 'donchian-breakout', 0.70);
	printWalkForwardReport(ethWfo);

	// WFO on NEARUSDT Donchian
	const nearWfo = runWalkForward(nearCandles, platformConfig, nearRisk, 'NEARUSDT', '4h', 'donchian-breakout', 0.70);
	printWalkForwardReport(nearWfo);

	// Save to JSON
	const outData = {
		ethPlateau,
		nearPlateau,
		oosResults: {
			eth: { is: ethISRes.totalReturn, oos: ethOOSRes.totalReturn },
			near: { is: nearISRes.totalReturn, oos: nearOOSRes.totalReturn }
		},
		wfoResults: {
			eth: ethWfo,
			near: nearWfo
		}
	};
	const outPath = join(process.cwd(), 'results', 'wfo_stability_validation.json');
	writeFileSync(outPath, JSON.stringify(outData, null, 2), 'utf-8');
	console.log(`Saved validation results to: ${outPath}`);
}

run().catch(console.error);
