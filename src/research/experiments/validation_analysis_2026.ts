import { runBacktest } from '../backtester.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import type { Candle, PlatformConfig, RiskConfig } from '../../../core/types.js';
import { getCandles } from '../../data/binance-client.js';
import { runMonteCarlo } from '../analytics/monte-carlo.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── VWAP Strategy Builder ────────────────────────────────────────────────────
function buildVwapStrategy(period: number, threshold: number, candles: Candle[]) {
	const config = {
		metadata: { name: `vwap-${period}-${threshold}`, version: "1.0.0", tags: [], category: "Mean Reversion", author: "" },
		warmupPeriod: period,
		indicators: [
			{ id: "vw", type: "vwap", params: [period] }
		],
		filters: [],
		entry: { type: "comparison", operator: "<", left: { type: "indicator", id: "vw" }, right: { type: "constant", value: -threshold } },
		exit: { type: "comparison", operator: ">", left: { type: "indicator", id: "vw" }, right: { type: "constant", value: threshold } }
	};
	return createStrategyFromConfig(config as any, candles).strategy;
}

async function run() {
	const coin = 'BTCUSDT';
	const interval = '4h';
	
	// 1) Load all candles from 2022 to 2026 from Binance
	const startTime = new Date('2022-01-01T00:00:00Z').getTime();
	const endTime = new Date('2026-07-06T23:59:59Z').getTime();
	
	console.log(`[Validation Lab] Fetching ${coin} 4h history from 2022 to 2026...`);
	const candles = await getCandles(coin, interval, startTime, endTime);
	console.log(`Loaded ${candles.length} candles.`);

	const platformConfig: PlatformConfig = {
		initialCapital: 10000,
		commissionPercent: 0.10,
		slippagePercent: 0.05
	};

	const baseRisk: RiskConfig = {
		maxPositionPercent: 100,
		maxDailyLossPercent: 100,
		maxOrderValue: 10000,
		stopLossPercent: 0.05, // SL 5%
		takeProfitPercent: 0.10, // TP 10%
		stopLossAtrMultiplier: 3.0 // ATR Mult 3
	};

	const rawDefaults = {
		strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
		filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
		confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
	};

	// ─── TEST 1: Multi-Year Analysis ──────────────────────────────────────────
	console.log("\n[Test 1] Running Multi-Year Backtests...");
	const years = [2022, 2023, 2024, 2025, 2026];
	const yearlyResults = [];

	for (const y of years) {
		const yStart = new Date(`${y}-01-01T00:00:00Z`).getTime();
		const yEnd = new Date(`${y}-12-31T23:59:59Z`).getTime();
		const yearCandles = candles.filter(c => c.openTime >= yStart && c.openTime <= yEnd);

		if (yearCandles.length < 50) {
			console.log(`Skipping year ${y} due to insufficient data.`);
			continue;
		}

		const strategy = buildVwapStrategy(10, 2.5, yearCandles);
		const res = runBacktest(strategy, yearCandles, platformConfig, baseRisk, coin, rawDefaults);
		yearlyResults.push({
			year: y,
			return: res.totalReturn,
			sharpe: res.sharpeRatio,
			drawdown: res.maxDrawdown,
			trades: res.totalTrades,
			winRate: res.winRate
		});
	}

	console.log("\n📅 MULTI-YEAR PERFORMANCE (VWAP 10, 2.5):");
	console.log("═".repeat(80));
	yearlyResults.forEach(r => {
		console.log(`  Year ${r.year} | Return: ${r.return > 0 ? '+' : ''}${r.return.toFixed(2)}% | Sharpe: ${r.sharpe.toFixed(2)} | MDD: -${r.drawdown.toFixed(2)}% | Trades: ${r.trades} (WR: ${r.winRate.toFixed(1)}%)`);
	});

	// ─── TEST 2: Parameter Stability Heatmap (2022-2026 Combined) ─────────────
	console.log("\n[Test 2] Generating Parameter Stability Heatmap (2022-2026 Combined)...");
	const periods = [8, 9, 10, 11, 12];
	const thresholds = [2.0, 2.2, 2.5, 2.8, 3.0];
	const stabilityGrid: any[] = [];

	for (const period of periods) {
		const row: any = { period };
		for (const threshold of thresholds) {
			const strategy = buildVwapStrategy(period, threshold, candles);
			const res = runBacktest(strategy, candles, platformConfig, baseRisk, coin, rawDefaults);
			row[`t_${threshold}`] = {
				return: res.totalReturn,
				sharpe: res.sharpeRatio,
				trades: res.totalTrades
			};
		}
		stabilityGrid.push(row);
	}

	console.log("\n📈 PARAMETER STABILITY GRID (Return %):");
	console.log("═".repeat(80));
	console.log("  Period | Th: 2.0   | Th: 2.2   | Th: 2.5   | Th: 2.8   | Th: 3.0");
	console.log("─".repeat(80));
	stabilityGrid.forEach(row => {
		const val = (t: number) => {
			const cell = row[`t_${t}`];
			return `${cell.return > 0 ? '+' : ''}${cell.return.toFixed(1)}% (${cell.trades})`;
		};
		console.log(`  ${String(row.period).padEnd(6)} | ${val(2.0).padEnd(9)} | ${val(2.2).padEnd(9)} | ${val(2.5).padEnd(9)} | ${val(2.8).padEnd(9)} | ${val(3.0)}`);
	});

	// ─── TEST 3: Monte Carlo Shuffle & Bootstrap (2022-2026 Combined) ─────────
	console.log("\n[Test 3] Running Monte Carlo Simulations (10,000 runs)...");
	const fullStrategy = buildVwapStrategy(10, 2.5, candles);
	const fullRes = runBacktest(fullStrategy, candles, platformConfig, baseRisk, coin, rawDefaults);
	const tradeReturns = fullRes.trades.map(t => t.pnlPercent);

	console.log(`Total trades in full period: ${tradeReturns.length}`);
	const mcShuffle = runMonteCarlo(tradeReturns, platformConfig.initialCapital, { method: 'shuffle', simulationsCount: 10000 });
	const mcBootstrap = runMonteCarlo(tradeReturns, platformConfig.initialCapital, { method: 'bootstrap', simulationsCount: 10000 });

	console.log("\n🎲 MONTE CARLO SHUFFLE QUANTILE RESULTS:");
	console.log("═".repeat(80));
	console.log(`  Risk of Ruin (30% Drawdown): ${mcShuffle.riskOfRuinPercent}%`);
	console.log(`  Worst Capital              : $${mcShuffle.capitalQuantiles.worst}`);
	console.log(`  P5 (95% Confidence floor)  : $${mcShuffle.capitalQuantiles.p5}`);
	console.log(`  P50 (Median expectation)   : $${mcShuffle.capitalQuantiles.p50}`);
	console.log(`  P95 (Outperformance)       : $${mcShuffle.capitalQuantiles.p95}`);
	console.log(`  Best Capital               : $${mcShuffle.capitalQuantiles.best}`);
	console.log(`  P50 Max Drawdown           : ${mcShuffle.drawdownQuantiles.p50}%`);
	console.log(`  P95 Max Drawdown           : ${mcShuffle.drawdownQuantiles.p95}%`);

	// 4) Save metrics to JSON for reporting
	const outData = {
		yearlyResults,
		stabilityGrid,
		mcShuffle,
		mcBootstrap,
		totalTrades: tradeReturns.length,
		fullReturn: fullRes.totalReturn,
		fullSharpe: fullRes.sharpeRatio,
		fullDrawdown: fullRes.maxDrawdown
	};

	const outPath = join(process.cwd(), 'results', 'validation_metrics.json');
	writeFileSync(outPath, JSON.stringify(outData, null, 2), 'utf-8');
	console.log(`\n[Validation Lab] Saved validation metrics to: ${outPath}`);
}

run().catch(console.error);
