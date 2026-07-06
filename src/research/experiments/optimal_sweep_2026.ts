import { CSVProvider } from '../../data/csv-provider.js';
import { runBacktest } from '../backtester.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import { createEmaCrossStrategy } from '../strategies/ema-cross/index.js';
import { createSmaCrossStrategy } from '../strategies/sma-cross/index.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';
import type { Candle, PlatformConfig, RiskConfig } from '../../../core/types.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── Strategy Builder Helper ──────────────────────────────────────────────────
function buildStrategy(type: string, params: any, candles: Candle[]) {
	switch (type) {
		case 'ema-cross':
			return createEmaCrossStrategy(params.fast, params.slow);
		case 'sma-cross':
			return createSmaCrossStrategy(params.fast, params.slow);
		case 'donchian-breakout':
			return createDonchianBreakoutStrategy(params.period);
		case 'supertrend': {
			const config = {
				metadata: { name: `supertrend-${params.period}-${params.multiplier}`, version: "1.0.0", tags: [], category: "Trend", author: "" },
				warmupPeriod: 50,
				indicators: [
					{ id: "st", type: "supertrend", params: [params.period, params.multiplier] }
				],
				filters: [],
				entry: { type: "comparison", operator: "==", left: { type: "indicator", id: "st.direction" }, right: { type: "constant", value: 1 } },
				exit: { type: "comparison", operator: "==", left: { type: "indicator", id: "st.direction" }, right: { type: "constant", value: -1 } }
			};
			return createStrategyFromConfig(config as any, candles).strategy;
		}
		case 'vwap-zscore': {
			const config = {
				metadata: { name: `vwap-${params.period}-${params.threshold}`, version: "1.0.0", tags: [], category: "Mean Reversion", author: "" },
				warmupPeriod: params.period,
				indicators: [
					{ id: "vw", type: "vwap", params: [params.period] }
				],
				filters: [],
				entry: { type: "comparison", operator: "<", left: { type: "indicator", id: "vw" }, right: { type: "constant", value: -params.threshold } },
				exit: { type: "comparison", operator: ">", left: { type: "indicator", id: "vw" }, right: { type: "constant", value: params.threshold } }
			};
			return createStrategyFromConfig(config as any, candles).strategy;
		}
		case 'bollinger-bands': {
			const config = {
				metadata: { name: `bollinger-${params.period}-${params.multiplier}`, version: "1.0.0", tags: [], category: "Mean Reversion", author: "" },
				warmupPeriod: params.period,
				indicators: [
					{ id: "bb", type: "bollinger", params: [params.period, params.multiplier] }
				],
				filters: [],
				entry: { type: "comparison", operator: "<", left: { type: "indicator", id: "close" }, right: { type: "indicator", id: "bb.lower" } },
				exit: { type: "comparison", operator: ">", left: { type: "indicator", id: "close" }, right: { type: "indicator", id: "bb.upper" } }
			};
			return createStrategyFromConfig(config as any, candles).strategy;
		}
		default:
			throw new Error(`Unknown strategy type: ${type}`);
	}
}

async function run() {
	console.log("Loading candles...");
	const provider = new CSVProvider();
	const candles = await provider.getHistory('BTCUSDT', '4h');

	// Filter candles for 2026-01-01 to 2026-07-06
	const startTime = new Date('2026-01-01T00:00:00Z').getTime();
	const endTime = new Date('2026-07-06T23:59:59Z').getTime();
	const testCandles = candles.filter(c => c.openTime >= startTime && c.openTime <= endTime);

	console.log(`Filtered candles: ${testCandles.length} candles.`);
	if (testCandles.length === 0) {
		console.error("No candles found in test range.");
		return;
	}

	const platformConfig: PlatformConfig = {
		initialCapital: 10000,
		commissionPercent: 0.10,
		slippagePercent: 0.05
	};

	// ─── Combinations Definition ──────────────────────────────────────────────
	const strategies = [
		// Donchian Breakout
		...[10, 15, 20, 30, 40, 50].map(period => ({ type: 'donchian-breakout', label: `Donchian-${period}`, params: { period } })),
		// EMA Cross
		...[[5, 15], [9, 21], [10, 30], [20, 50]].map(([fast, slow]) => ({ type: 'ema-cross', label: `EMA-${fast}/${slow}`, params: { fast, slow } })),
		// SMA Cross
		...[[5, 15], [10, 30], [20, 50]].map(([fast, slow]) => ({ type: 'sma-cross', label: `SMA-${fast}/${slow}`, params: { fast, slow } })),
		// Supertrend
		...[[10, 2.0], [10, 3.0], [20, 2.0], [20, 3.0]].map(([period, multiplier]) => ({ type: 'supertrend', label: `Supertrend-${period}-${multiplier}`, params: { period, multiplier } })),
		// Bollinger Bands
		...[[10, 1.5], [10, 2.0], [10, 2.5], [20, 1.5], [20, 2.0], [20, 2.5], [30, 1.5], [30, 2.0], [30, 2.5]].map(([period, multiplier]) => ({ type: 'bollinger-bands', label: `Bollinger-${period}-${multiplier}`, params: { period, multiplier } })),
		// VWAP Z-Score
		...[[10, 1.5], [10, 2.0], [10, 2.5], [20, 1.5], [20, 2.0], [20, 2.5], [30, 1.5], [30, 2.0], [30, 2.5]].map(([period, threshold]) => ({ type: 'vwap-zscore', label: `VWAP-${period}-${threshold}`, params: { period, threshold } }))
	];

	const riskParamsList = [];
	const sls = [0, 0.02, 0.03, 0.05];
	const tps = [0, 0.10, 0.15];
	const atrs = [0, 1.5, 2.0, 3.0];

	for (const sl of sls) {
		for (const tp of tps) {
			for (const atr of atrs) {
				riskParamsList.push({
					maxPositionPercent: 100,
					maxDailyLossPercent: 100,
					maxOrderValue: 10000,
					stopLossPercent: sl,
					takeProfitPercent: tp,
					stopLossAtrMultiplier: atr
				});
			}
		}
	}

	const filterConfigs = [
		{ name: 'Raw (No Filters)', adx: 0, rvol: 0, minConf: 0 },
		{ name: 'Moderate (ADX>20, RVOL>1.5)', adx: 20, rvol: 1.5, minConf: 70 },
		{ name: 'Strict (ADX>25, RVOL>2.0)', adx: 25, rvol: 2.0, minConf: 80 }
	];

	console.log(`\nStarting sweep of:`);
	console.log(`  - Strategies   : ${strategies.length}`);
	console.log(`  - Risk configs : ${riskParamsList.length}`);
	console.log(`  - Filter setups: ${filterConfigs.length}`);
	console.log(`  Total combinations: ${strategies.length * riskParamsList.length * filterConfigs.length}\n`);

	const results = [];
	let count = 0;

	for (const stratInfo of strategies) {
		// Compile strategy instance
		let strategy;
		try {
			strategy = buildStrategy(stratInfo.type, stratInfo.params, testCandles);
		} catch (e) {
			// Skip if warmup period too large
			continue;
		}

		for (const risk of riskParamsList) {
			for (const filter of filterConfigs) {
				const strategyDefaults = {
					strategies: {
						emaCross: { fast: 9, slow: 21 },
						smaCross: { fast: 10, slow: 30 }
					},
					filters: {
						adxPeriod: 14,
						adxVetoThreshold: filter.adx,
						rvolLookback: 20,
						rvolVetoThreshold: filter.rvol
					},
					confidence: {
						baseScore: 40,
						adxStrongThreshold: 25,
						adxStrongBonus: 30,
						rvolHighThreshold: 2.0,
						rvolHighBonus: 30,
						minimumScore: filter.minConf
					}
				};

				try {
					const backtestResult = runBacktest(strategy, testCandles, platformConfig, risk, 'BTCUSDT', strategyDefaults);
					results.push({
						strategyLabel: stratInfo.label,
						strategyType: stratInfo.type,
						params: stratInfo.params,
						risk,
						filter,
						totalReturn: backtestResult.totalReturn,
						sharpeRatio: backtestResult.sharpeRatio,
						profitFactor: backtestResult.profitFactor,
						maxDrawdown: backtestResult.maxDrawdown,
						totalTrades: backtestResult.totalTrades,
						winRate: backtestResult.winRate,
						rejectedSignals: backtestResult.rejectedSignals
					});
				} catch (e) {
					// Ignore failures for specific configuration
				}

				count++;
				if (count % 1000 === 0) {
					process.stdout.write(`\r  ⏳ Completed: ${count}/${strategies.length * riskParamsList.length * filterConfigs.length}`);
				}
			}
		}
	}
	console.log(`\n  ✅ Sweep complete!`);

	// Sort results by return and Sharpe
	const sorted = results
		.filter(r => r.totalTrades > 2) // must have at least 3 trades
		.sort((a, b) => b.totalReturn - a.totalReturn);

	console.log(`\n🏆 TOP 15 LEADERBOARD (Sorted by Return):`);
	console.log("═".repeat(80));
	const top = sorted.slice(0, 15);
	top.forEach((r, idx) => {
		console.log(`#${idx + 1} | ${r.strategyLabel} | Return: +${r.totalReturn.toFixed(2)}% | Sharpe: ${r.sharpeRatio.toFixed(2)} | MDD: -${r.maxDrawdown.toFixed(2)}% | Trades: ${r.totalTrades} (WR: ${r.winRate.toFixed(1)}%)`);
		console.log(`   - Risk   : SL ${r.risk.stopLossPercent * 100}%, TP ${r.risk.takeProfitPercent * 100}%, ATR Mult ${r.risk.stopLossAtrMultiplier}`);
		console.log(`   - Filter : ${r.filter.name}`);
		console.log("─".repeat(80));
	});

	// Also sort by Sharpe
	const sortedBySharpe = [...results]
		.filter(r => r.totalTrades > 2 && r.sharpeRatio > 0)
		.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

	console.log(`\n🏆 TOP 15 LEADERBOARD (Sorted by Sharpe Ratio):`);
	console.log("═".repeat(80));
	const topSharpe = sortedBySharpe.slice(0, 15);
	topSharpe.forEach((r, idx) => {
		console.log(`#${idx + 1} | ${r.strategyLabel} | Sharpe: ${r.sharpeRatio.toFixed(2)} | Return: +${r.totalReturn.toFixed(2)}% | MDD: -${r.maxDrawdown.toFixed(2)}% | Trades: ${r.totalTrades} (WR: ${r.winRate.toFixed(1)}%)`);
		console.log(`   - Risk   : SL ${r.risk.stopLossPercent * 100}%, TP ${r.risk.takeProfitPercent * 100}%, ATR Mult ${r.risk.stopLossAtrMultiplier}`);
		console.log(`   - Filter : ${r.filter.name}`);
		console.log("─".repeat(80));
	});

	// Save all to CSV
	const csvRows = ["Strategy,Type,Return,Sharpe,Drawdown,Trades,WinRate,StopLossPercent,TakeProfitPercent,AtrMultiplier,FilterName"];
	results.forEach(r => {
		csvRows.push(`${r.strategyLabel},${r.strategyType},${r.totalReturn},${r.sharpeRatio},${r.maxDrawdown},${r.totalTrades},${r.winRate},${r.risk.stopLossPercent},${r.risk.takeProfitPercent},${r.risk.stopLossAtrMultiplier},${r.filter.name}`);
	});

	const outPath = join(process.cwd(), 'results', 'sweep_optimal_2026.csv');
	writeFileSync(outPath, csvRows.join('\n'), 'utf-8');
	console.log(`\nSaved results to: ${outPath}`);
}

run().catch(console.error);
