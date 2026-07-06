import { runBacktest } from '../backtester.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import type { Candle, PlatformConfig, RiskConfig } from '../../../core/types.js';
import { getCandles } from '../../data/binance-client.js';
import { calculateQuantScore } from './runner.js';
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
	const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT', 'LTCUSDT'];
	const interval = '4h';
	
	// Test period: 2024-01-01 to 2026-07-06
	const startTime = new Date('2024-01-01T00:00:00Z').getTime();
	const endTime = new Date('2026-07-06T23:59:59Z').getTime();

	const platformConfig: PlatformConfig = {
		initialCapital: 10000,
		commissionPercent: 0.10,
		slippagePercent: 0.05
	};

	// ─── Strategies to Screen ─────────────────────────────────────────────────
	const strategies = [
		{ type: 'donchian-breakout', label: 'Donchian-20', params: { period: 20 } },
		{ type: 'donchian-breakout', label: 'Donchian-30', params: { period: 30 } },
		{ type: 'donchian-breakout', label: 'Donchian-50', params: { period: 50 } },
		{ type: 'ema-cross', label: 'EMA-9/21', params: { fast: 9, slow: 21 } },
		{ type: 'ema-cross', label: 'EMA-12/30', params: { fast: 12, slow: 30 } },
		{ type: 'ema-cross', label: 'EMA-15/50', params: { fast: 15, slow: 50 } },
		{ type: 'supertrend', label: 'Supertrend-10-2', params: { period: 10, multiplier: 2.0 } },
		{ type: 'supertrend', label: 'Supertrend-10-3', params: { period: 10, multiplier: 3.0 } },
		{ type: 'bollinger-bands', label: 'Bollinger-20-2', params: { period: 20, multiplier: 2.0 } },
		{ type: 'vwap-zscore', label: 'VWAP-10-2.5', params: { period: 10, threshold: 2.5 } }
	];

	// Conservative Risk Setups (SL: 3% or 5%, TP: 10%, ATR: 1.5 or 2)
	const riskSetups = [
		{ stopLossPercent: 0.03, takeProfitPercent: 0.10, stopLossAtrMultiplier: 1.5 },
		{ stopLossPercent: 0.03, takeProfitPercent: 0.10, stopLossAtrMultiplier: 2.0 },
		{ stopLossPercent: 0.05, takeProfitPercent: 0.10, stopLossAtrMultiplier: 1.5 },
		{ stopLossPercent: 0.05, takeProfitPercent: 0.10, stopLossAtrMultiplier: 2.0 }
	];

	// Filter Setups
	const filterSetups = [
		{ name: 'Moderate (ADX>20, RVOL>1.5)', adx: 20, rvol: 1.5, minConf: 70 },
		{ name: 'Strict (ADX>25, RVOL>2.0)', adx: 25, rvol: 2.0, minConf: 80 }
	];

	const safeCandidates = [];
	const allResults = [];

	console.log(`[Portfolio Screening] Commencing multi-asset screening for ${coins.length} coins...`);
	
	for (const coin of coins) {
		console.log(`\n📥 Fetching candles for ${coin}...`);
		const candles = await getCandles(coin, interval, startTime, endTime);
		console.log(`Loaded ${candles.length} candles for ${coin}.`);
		
		for (const stratInfo of strategies) {
			let strategy;
			try {
				strategy = buildStrategy(stratInfo.type, stratInfo.params, candles);
			} catch (e) {
				continue;
			}

			for (const risk of riskSetups) {
				for (const filter of filterSetups) {
					const strategyDefaults = {
						strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
						filters: { adxPeriod: 14, adxVetoThreshold: filter.adx, rvolLookback: 20, rvolVetoThreshold: filter.rvol },
						confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: filter.minConf }
					};

					try {
						const riskConfig: RiskConfig = {
							maxPositionPercent: 100,
							maxDailyLossPercent: 100,
							maxOrderValue: 10000,
							...risk
						};

						const res = runBacktest(strategy, candles, platformConfig, riskConfig, coin, strategyDefaults);
						const score = calculateQuantScore(res);

						// Compute risk of ruin percent (using Trades Returns)
						const trades = res.trades || [];
						const winRate = res.winRate / 100;
						const winningTrades = trades.filter((t: any) => t.pnlPercent > 0);
						const losingTrades = trades.filter((t: any) => t.pnlPercent <= 0);

						const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum: number, t: any) => sum + t.pnlPercent, 0) / winningTrades.length : 0;
						const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum: number, t: any) => sum + t.pnlPercent, 0) / losingTrades.length) : 0;
						const rMultiple = avgLoss > 0 ? avgWin / avgLoss : avgWin;
						const expectancy = winRate * rMultiple - (1 - winRate);

						// Extract MC statistics
						let riskOfRuin = 1.0;
						if (trades.length >= 3 && expectancy > 0) {
							// We can reconstruct MC metrics
							const pnlList = trades.map((t: any) => t.pnlPercent);
							const { runMonteCarlo } = await import('../analytics/monte-carlo.js');
							const mc = runMonteCarlo(pnlList, 10000, { method: 'shuffle', simulationsCount: 200 });
							riskOfRuin = mc.riskOfRuinPercent / 100;
						}

						const record = {
							coin,
							strategyLabel: stratInfo.label,
							strategyType: stratInfo.type,
							params: stratInfo.params,
							risk,
							filterName: filter.name,
							return: res.totalReturn,
							sharpe: res.sharpeRatio,
							maxDd: res.maxDrawdown,
							tradesCount: res.totalTrades,
							winRate: res.winRate,
							quantScore: score,
							riskOfRuin
						};

						allResults.push(record);

						// Conservative Safe Screening Criteria:
						// 1. quantScore >= 1.0
						// 2. riskOfRuin <= 0.05 (5% risk of ruin)
						// 3. maxDrawdown <= 20%
						// 4. tradesCount >= 12
						if (score >= 1.0 && riskOfRuin <= 0.05 && res.maxDrawdown <= 20.0 && res.totalTrades >= 12) {
							safeCandidates.push(record);
							console.log(`  ✨ [SAFE CAPTURED] ${coin} | ${stratInfo.label} | Score: ${score.toFixed(2)} | Ruin: ${(riskOfRuin*100).toFixed(1)}% | DD: -${res.maxDrawdown.toFixed(1)}% | Trades: ${res.totalTrades}`);
						}
					} catch (e) {
						// Skip fails
					}
				}
			}
		}
	}

	console.log(`\n✅ Portfolio screening complete!`);
	console.log(`Total setups scanned: ${allResults.length}`);
	console.log(`Safe tradeable setups captured: ${safeCandidates.length}`);

	// Sort safe candidates by Quant Score
	const sortedSafe = safeCandidates.sort((a, b) => b.quantScore - a.quantScore);

	console.log(`\n🏆 TOP SAFE TRADEABLE SETUPS:`);
	console.log("═".repeat(100));
	sortedSafe.slice(0, 10).forEach((r, idx) => {
		console.log(`#${idx + 1} | ${r.coin} | ${r.strategyLabel} | Score: ${r.quantScore.toFixed(4)} | Return: +${r.return.toFixed(2)}% | Sharpe: ${r.sharpe.toFixed(2)} | MDD: -${r.maxDd.toFixed(2)}% | Trades: ${r.tradesCount}`);
		console.log(`   - Risk: SL ${r.risk.stopLossPercent * 100}%, TP ${r.risk.takeProfitPercent * 100}%, ATR ${r.risk.stopLossAtrMultiplier}`);
		console.log(`   - Filter: ${r.filterName} | Risk of Ruin: ${(r.riskOfRuin * 100).toFixed(2)}%`);
		console.log("─".repeat(100));
	});

	// Save all screening results to JSON
	const outData = {
		timestamp: new Date().toISOString(),
		totalScanned: allResults.length,
		totalSafe: safeCandidates.length,
		safeCandidates: sortedSafe,
		topAll: allResults.sort((a, b) => b.quantScore - a.quantScore).slice(0, 50)
	};

	const outPath = join(process.cwd(), 'results', 'portfolio_screening_report.json');
	writeFileSync(outPath, JSON.stringify(outData, null, 2), 'utf-8');
	console.log(`Saved report details to: ${outPath}`);

	// Save CSV
	const csvRows = ["Coin,Strategy,QuantScore,Return,Sharpe,MaxDrawdown,Trades,WinRate,StopLossPercent,TakeProfitPercent,AtrMultiplier,FilterName,RiskOfRuin"];
	sortedSafe.forEach(r => {
		csvRows.push(`${r.coin},${r.strategyLabel},${r.quantScore},${r.return},${r.sharpe},${r.maxDd},${r.tradesCount},${r.winRate},${r.risk.stopLossPercent},${r.risk.takeProfitPercent},${r.risk.stopLossAtrMultiplier},${r.filterName},${r.riskOfRuin}`);
	});
	const csvPath = join(process.cwd(), 'results', 'portfolio_screening_safe.csv');
	writeFileSync(csvPath, csvRows.join('\n'), 'utf-8');
	console.log(`Saved safe CSV to: ${csvPath}`);
}

run().catch(console.error);
