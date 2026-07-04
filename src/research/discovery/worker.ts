// ============================================================================
// KRIPTOQUANT — Discovery Worker (Sprint 19)
// ============================================================================
// Bir aday stratejiye ait Kontrol Noktası (Checkpoint) zincirini çalıştırır.
// ============================================================================

import type { CandidateResult, CompositeAlphaScore } from './types.js';
import type { StrategyConfig } from '../strategies/factory/types.js';
import type { Candle, Strategy } from '../../core/types.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import { runBacktest } from '../backtester.js';
import { runPortfolioExecution } from '../../execution/portfolio/portfolio-engine.js';
import { CSVTimelineProvider } from '../../execution/portfolio/timeline-provider.js';
import { EqualWeightAllocation } from '../../execution/portfolio/allocation.js';
import { runMonteCarlo } from '../analytics/monte-carlo.js';

// Platform Konfigürasyonları
import defaultConfig from '../../../config/default.json' with { type: 'json' };
import riskConfig from '../../../config/risk.json' with { type: 'json' };

const platformConfig = defaultConfig;
const riskParams = riskConfig;

export class DiscoveryWorker {
	private readonly coins: string[];
	private readonly interval: string;
	private readonly candlesMap: Map<string, Candle[]>;

	constructor(coins: string[], interval: string, candlesMap: Map<string, Candle[]>) {
		this.coins = coins;
		this.interval = interval;
		this.candlesMap = candlesMap;
	}

	/**
	 * Bir adayın doğrulama boru hattını (pipeline) çalıştırır.
	 */
	async evaluate(candidate: StrategyConfig): Promise<CandidateResult> {
		const id = candidate.metadata.name;
		const firstCoin = this.coins[0];
		const firstCoinCandles = this.candlesMap.get(firstCoin) ?? [];

		// ── AŞAMA 1: Quick Backtest (İlk varlık) ──────────────────────────
		let firstCoinResult;
		let compiledStrategy: Strategy;
		try {
			const compiled = createStrategyFromConfig(candidate, firstCoinCandles);
			compiledStrategy = compiled.strategy;
			firstCoinResult = runBacktest(compiledStrategy, firstCoinCandles, platformConfig, riskParams, firstCoin);
		} catch (err) {
			return {
				id,
				config: candidate,
				stage: 'BACKTEST_FAILED',
				failureReason: `Derleme veya backtest hatası: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		if (firstCoinResult.totalReturn <= 0) {
			return {
				id,
				config: candidate,
				stage: 'BACKTEST_FAILED',
				failureReason: `Getiri negatif veya sıfır: ${firstCoinResult.totalReturn}%`,
			};
		}

		// ── AŞAMA 2: Minimum Trade Filter ─────────────────────────────────
		if (firstCoinResult.totalTrades < 10) {
			return {
				id,
				config: candidate,
				stage: 'INSUFFICIENT_TRADES',
				failureReason: `İşlem adedi yetersiz: ${firstCoinResult.totalTrades} < 10`,
			};
		}

		// ── AŞAMA 3: Multi-Asset Check ────────────────────────────────────
		const singleCoinResults: any[] = [firstCoinResult];
		for (let i = 1; i < this.coins.length; i++) {
			const coin = this.coins[i];
			const candles = this.candlesMap.get(coin) ?? [];
			try {
				const compiled = createStrategyFromConfig(candidate, candles);
				const res = runBacktest(compiled.strategy, candles, platformConfig, riskParams, coin);
				if (res.totalReturn <= 0) {
					return {
						id,
						config: candidate,
						stage: 'MULTI_ASSET_FAILED',
						failureReason: `${coin} üzerinde getiri negatif veya sıfır: ${res.totalReturn}%`,
					};
				}
				singleCoinResults.push(res);
			} catch (err) {
				return {
					id,
					config: candidate,
					stage: 'MULTI_ASSET_FAILED',
					failureReason: `${coin} üzerinde test hatası: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}

		// ── AŞAMA 4: Monte Carlo Check ────────────────────────────────────
		const pnlPercentages = firstCoinResult.trades.map((t) => t.pnlPercent);
		const mc = runMonteCarlo(pnlPercentages, platformConfig.initialCapital, {
			method: 'bootstrap',
			simulationsCount: 500,
			ruinThresholdPercent: 30,
		});

		if (mc.riskOfRuinPercent > 5) {
			return {
				id,
				config: candidate,
				stage: 'MONTE_CARLO_FAILED',
				failureReason: `Monte Carlo İflas Riski yüksek: ${mc.riskOfRuinPercent}% > 5%`,
			};
		}

		// ── AŞAMA 5: Portfolio Simulation ─────────────────────────────────
		const strategiesMap = new Map<string, Strategy>();
		for (const coin of this.coins) {
			const candles = this.candlesMap.get(coin) ?? [];
			const compiled = createStrategyFromConfig(candidate, candles);
			strategiesMap.set(coin, compiled.strategy);
		}

		const timelineProvider = new CSVTimelineProvider();
		const alignedTimeline = timelineProvider.alignCandles(this.candlesMap);

		const portfolioResult = runPortfolioExecution(
			alignedTimeline,
			this.candlesMap,
			strategiesMap,
			new EqualWeightAllocation(),
			platformConfig,
			riskParams,
			{ maxPositions: 5, preventDoublePosition: true },
		);

		// Bileşik Skorlama (Composite Score)
		const score = this.calculateCompositeScore(portfolioResult, singleCoinResults);

		return {
			id,
			config: candidate,
			stage: 'PASSED',
			score,
			totalReturn: portfolioResult.totalReturn,
			maxDrawdown: portfolioResult.maxDrawdown,
			sharpeRatio: portfolioResult.sharpeRatio,
			tradeCount: portfolioResult.totalTrades,
			riskOfRuinPercent: mc.riskOfRuinPercent,
		};
	}

	/**
	 * Adayın bileşik skor kartı (Composite Scorecard) verilerini hesaplar.
	 */
	private calculateCompositeScore(portfolioResult: any, singleCoinResults: any[]): CompositeAlphaScore {
		// 1. Profitability (0-100)
		const profitability = Math.max(0, Math.min(100, portfolioResult.totalReturn));

		// 2. Risk (0-100)
		const dd = portfolioResult.maxDrawdown;
		const risk = Math.max(0, Math.min(100, 100 - dd * 3));

		// 3. Consistency (0-100)
		const sharpe = portfolioResult.sharpeRatio ?? 0;
		const consistency = Math.max(0, Math.min(100, sharpe * 33.3));

		// 4. Regime Coverage (0-100)
		const winRate = portfolioResult.winRate;
		const regimeCoverage = winRate;

		// 5. Robustness (0-100) - Varlıklar arası standart sapma ne kadar azsa o kadar robust
		let robustness = 100;
		if (singleCoinResults.length > 1) {
			const returns = singleCoinResults.map((r) => r.totalReturn);
			const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
			const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
			const stdDev = Math.sqrt(variance);
			robustness = Math.max(0, Math.min(100, 100 - stdDev * 2));
		}

		// Ağırlıklı overall skor hesaplama
		const overall =
			profitability * 0.3 +
			risk * 0.2 +
			consistency * 0.2 +
			regimeCoverage * 0.1 +
			robustness * 0.2;

		return {
			profitability: Math.round(profitability * 100) / 100,
			risk: Math.round(risk * 100) / 100,
			consistency: Math.round(consistency * 100) / 100,
			regimeCoverage: Math.round(regimeCoverage * 100) / 100,
			robustness: Math.round(robustness * 100) / 100,
			overall: Math.round(overall * 100) / 100,
		};
	}
}
