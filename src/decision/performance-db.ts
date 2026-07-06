// ============================================================================
// KRIPTOQUANT — Strategy Performance Database (Sprint 29)
// ============================================================================

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log, logError } from '../core/utils.js';

export interface StrategyStats {
	strategyName: string;
	winRate: number; // 0.0 - 1.0
	expectancy: number; // Expectancy in R-multiple (e.g. 0.35)
	profitFactor: number;
	averageR: number;
	maxDrawdown: number; // 0.0 - 1.0
	sharpeRatio: number;
	sampleSize: number; // Number of trades
}

export class PerformanceDB {
	private cache: Record<string, StrategyStats> = {};
	private resultsDir: string;

	constructor() {
		this.resultsDir = join(process.cwd(), 'results');
		this.loadStatsFromReports();
	}

	private loadStatsFromReports() {
		if (!existsSync(this.resultsDir)) return;

		try {
			const files = readdirSync(this.resultsDir);
			const strategyGroups: Record<string, any[]> = {};

			// Group reports by strategy name
			for (const file of files) {
				if (file.endsWith('.json') && file !== 'alpha_discovery_registry.json' && file !== 'live_paper_state.json' && file !== 'screener_state.json') {
					try {
						const raw = readFileSync(join(this.resultsDir, file), 'utf-8');
						const data = JSON.parse(raw);
						
						const strat = data.strategyName;
						if (strat && typeof data.initialCapital === 'number') {
							if (!strategyGroups[strat]) strategyGroups[strat] = [];
							strategyGroups[strat].push(data);
						}
					} catch {}
				}
			}

			// Aggregate stats for each strategy
			for (const strat of Object.keys(strategyGroups)) {
				const reports = strategyGroups[strat];
				
				let totalTrades = 0;
				let winRateSum = 0;
				let sharpeSum = 0;
				let maxDdSum = 0;
				let pfSum = 0;
				let avgWinSum = 0;
				let avgLossSum = 0;
				let reportCount = 0;

				reports.forEach(r => {
					if (r.totalTrades > 0) {
						totalTrades += r.totalTrades;
						winRateSum += r.winRate || 0;
						sharpeSum += r.sharpeRatio || 0;
						maxDdSum += r.maxDrawdown || 0;
						pfSum += r.profitFactor || 0;
						avgWinSum += r.avgWin || 0;
						avgLossSum += Math.abs(r.avgLoss || 1);
						reportCount++;
					}
				});

				if (reportCount > 0) {
					const winRate = (winRateSum / reportCount) / 100;
					const avgWin = avgWinSum / reportCount;
					const avgLoss = avgLossSum / reportCount;
					
					// Calculate Expectancy in R-multiple: WinRate * R - (1 - WinRate)
					const rMultiple = avgLoss > 0 ? (avgWin / avgLoss) : 1;
					const expectancy = winRate * rMultiple - (1 - winRate);

					this.cache[strat] = {
						strategyName: strat,
						winRate: parseFloat(winRate.toFixed(4)),
						expectancy: parseFloat(expectancy.toFixed(4)),
						profitFactor: parseFloat((pfSum / reportCount).toFixed(2)),
						averageR: parseFloat(rMultiple.toFixed(2)),
						maxDrawdown: parseFloat(((maxDdSum / reportCount) / 100).toFixed(4)),
						sharpeRatio: parseFloat((sharpeSum / reportCount).toFixed(3)),
						sampleSize: totalTrades
					};
				}
			}

			log(`PerformanceDB loaded stats for ${Object.keys(this.cache).length} strategies from backtests.`);
		} catch (e) {
			logError(`Failed to load stats in PerformanceDB: ${e}`);
		}
	}

	public getStrategyStats(strategyName: string): StrategyStats {
		// Fallback defaults if strategy statistics are missing
		const defaults: Record<string, StrategyStats> = {
			'ema-cross': {
				strategyName: 'ema-cross',
				winRate: 0.45,
				expectancy: 0.25,
				profitFactor: 1.6,
				averageR: 2.2,
				maxDrawdown: 0.08,
				sharpeRatio: 2.1,
				sampleSize: 45
			},
			'donchian-breakout': {
				strategyName: 'donchian-breakout',
				winRate: 0.38,
				expectancy: 0.32,
				profitFactor: 1.8,
				averageR: 3.1,
				maxDrawdown: 0.12,
				sharpeRatio: 1.8,
				sampleSize: 30
			},
			'sma-cross': {
				strategyName: 'sma-cross',
				winRate: 0.42,
				expectancy: 0.20,
				profitFactor: 1.4,
				averageR: 1.8,
				maxDrawdown: 0.10,
				sharpeRatio: 1.5,
				sampleSize: 40
			}
		};

		return this.cache[strategyName] ?? defaults[strategyName] ?? {
			strategyName,
			winRate: 0.40,
			expectancy: 0.15,
			profitFactor: 1.3,
			averageR: 1.7,
			maxDrawdown: 0.10,
			sharpeRatio: 1.2,
			sampleSize: 20
		};
	}
}
