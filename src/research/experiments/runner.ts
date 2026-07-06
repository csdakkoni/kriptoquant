// ============================================================================
// KRIPTOQUANT — Experiment Runner (Sprint 8 — Multi-Strategy)
// ============================================================================
// Tek bir parametre kombinasyonunu backtest'e dönüştüren saf fonksiyon.
// Yan etkisi yok. Worker thread'lerde güvenle çalıştırılabilir.
// Yeni strateji eklemek = createStrategy'ye bir case eklemek.
// ============================================================================

import type {
	Candle,
	PlatformConfig,
	RiskConfig,
	Strategy,
	StrategyDefaultsConfig,
} from '../../core/types.js';
import { runBacktest } from '../backtester.js';
import { createEmaCrossStrategy } from '../strategies/ema-cross/index.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';
import { runMonteCarlo } from '../analytics/monte-carlo.js';


// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface ExperimentParams {
	readonly strategyName: string;
	// EMA-specific
	readonly emaFast?: number;
	readonly emaSlow?: number;
	// Donchian-specific
	readonly donchianPeriod?: number;
	// Shared filter params
	readonly adxVetoThreshold: number;
	readonly rvolVetoThreshold: number;
	readonly minimumConfidence: number;
}

export interface ExperimentResult {
	readonly params: ExperimentParams;
	readonly totalReturn: number;
	readonly sharpeRatio: number;
	readonly profitFactor: number;
	readonly maxDrawdown: number;
	readonly totalTrades: number;
	readonly winRate: number;
	readonly rejectedSignals: number;
	readonly acceptedSignals: number;
	readonly totalSignals: number;
	readonly alpha: number;
	readonly quantScore: number;
}

export interface SweepConfig {
	// EMA params (yoksa EMA taranmaz)
	readonly emaFast?: number[];
	readonly emaSlow?: number[];
	// Donchian params (yoksa Donchian taranmaz)
	readonly donchianPeriod?: number[];
	// Shared filter params
	readonly adxVetoThreshold: number[];
	readonly rvolVetoThreshold: number[];
	readonly minimumConfidence: number[];
}

// ─── Varsayılan Sweep Parametreleri ──────────────────────────────────────────

export const DEFAULT_SWEEP: SweepConfig = {
	emaFast: [5, 7, 9, 12, 15],
	emaSlow: [20, 30, 50],
	donchianPeriod: [10, 15, 20, 25, 30],
	adxVetoThreshold: [15, 20, 25, 30],
	rvolVetoThreshold: [1.2, 1.5, 2.0],
	minimumConfidence: [60, 70, 80],
};

// ─── Strateji Factory ────────────────────────────────────────────────────────

/**
 * Parametre setinden strateji oluşturur.
 * Yeni strateji eklemek = buraya bir case eklemek.
 */
function createStrategy(params: ExperimentParams): Strategy {
	switch (params.strategyName) {
		case 'ema-cross':
			return createEmaCrossStrategy(params.emaFast!, params.emaSlow!);
		case 'donchian-breakout':
			return createDonchianBreakoutStrategy(params.donchianPeriod!);
		default:
			throw new Error(`Unknown strategy: ${params.strategyName}`);
	}
}

// ─── Kombinasyon Üretici ─────────────────────────────────────────────────────

/**
 * Tüm parametre kombinasyonlarını oluşturur.
 * Her strateji kendi parametre uzayını üretir, filtreler paylaşılır.
 */
export function generateCombinations(config: SweepConfig): ExperimentParams[] {
	const combinations: ExperimentParams[] = [];

	// EMA Cross kombinasyonları
	if (config.emaFast && config.emaSlow) {
		for (const emaFast of config.emaFast) {
			for (const emaSlow of config.emaSlow) {
				if (emaFast >= emaSlow) continue;

				for (const adx of config.adxVetoThreshold) {
					for (const rvol of config.rvolVetoThreshold) {
						for (const conf of config.minimumConfidence) {
							combinations.push({
								strategyName: 'ema-cross',
								emaFast,
								emaSlow,
								adxVetoThreshold: adx,
								rvolVetoThreshold: rvol,
								minimumConfidence: conf,
							});
						}
					}
				}
			}
		}
	}

	// Donchian Breakout kombinasyonları
	if (config.donchianPeriod) {
		for (const period of config.donchianPeriod) {
			for (const adx of config.adxVetoThreshold) {
				for (const rvol of config.rvolVetoThreshold) {
					for (const conf of config.minimumConfidence) {
						combinations.push({
							strategyName: 'donchian-breakout',
							donchianPeriod: period,
							adxVetoThreshold: adx,
							rvolVetoThreshold: rvol,
							minimumConfidence: conf,
						});
					}
				}
			}
		}
	}

	return combinations;
}

// ─── Tek Deney Çalıştırıcı ──────────────────────────────────────────────────

/**
 * Tek bir parametre kombinasyonunu backtest'e dönüştürür.
 * Saf fonksiyon — aynı girdi her zaman aynı çıktıyı verir.
 */
export function runExperiment(
	candles: Candle[],
	params: ExperimentParams,
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string,
): ExperimentResult {
	const strategy = createStrategy(params);

	const strategyDefaults: StrategyDefaultsConfig = {
		strategies: {
			emaCross: { fast: params.emaFast ?? 9, slow: params.emaSlow ?? 21 },
			smaCross: { fast: 10, slow: 30 },
		},
		filters: {
			adxPeriod: 14,
			adxVetoThreshold: params.adxVetoThreshold,
			rvolLookback: 20,
			rvolVetoThreshold: params.rvolVetoThreshold,
		},
		confidence: {
			baseScore: 40,
			adxStrongThreshold: 25,
			adxStrongBonus: 30,
			rvolHighThreshold: 2.0,
			rvolHighBonus: 30,
			minimumScore: params.minimumConfidence,
		},
	};

	const result = runBacktest(strategy, candles, platformConfig, riskConfig, coin, strategyDefaults);
	const scoreVal = calculateQuantScore(result);

	return {
		params,
		totalReturn: result.totalReturn,
		sharpeRatio: result.sharpeRatio,
		profitFactor: result.profitFactor,
		maxDrawdown: result.maxDrawdown,
		totalTrades: result.totalTrades,
		winRate: result.winRate,
		rejectedSignals: result.rejectedSignals,
		acceptedSignals: result.filterStats?.accepted ?? 0,
		totalSignals: result.filterStats?.totalSignals ?? 0,
		alpha: result.alpha,
		quantScore: scoreVal,
	};
}

export function calculateQuantScore(result: any): number {
	const trades = result.trades || [];
	if (trades.length < 3) return 0;

	// 1) Expectancy in R-multiple
	const winRate = result.winRate / 100;
	const winningTrades = trades.filter((t: any) => t.pnlPercent > 0);
	const losingTrades = trades.filter((t: any) => t.pnlPercent <= 0);

	const avgWin = winningTrades.length > 0
		? winningTrades.reduce((sum: number, t: any) => sum + t.pnlPercent, 0) / winningTrades.length
		: 0;
	const avgLoss = losingTrades.length > 0
		? Math.abs(losingTrades.reduce((sum: number, t: any) => sum + t.pnlPercent, 0) / losingTrades.length)
		: 0;

	const rMultiple = avgLoss > 0 ? avgWin / avgLoss : avgWin;
	const expectancy = winRate * rMultiple - (1 - winRate);

	// Optimization: negative expectancy immediately scores 0
	if (expectancy <= 0) return 0;

	// 2) Trade Count factor: sqrt(N)
	const tradeCountFactor = Math.sqrt(trades.length);

	// 3) Risk of Ruin (using Monte Carlo Shuffle, 100 iterations for speed)
	const pnlList = trades.map((t: any) => t.pnlPercent);
	const mc = runMonteCarlo(pnlList, 10000, { method: 'shuffle', simulationsCount: 100 });
	const riskOfRuin = mc.riskOfRuinPercent / 100;

	// 4) Stability: Profitability fraction of 4 chunks of equity timeline
	let stability = 0;
	if (result.timeline && result.timeline.length > 4) {
		const chunkSize = Math.floor(result.timeline.length / 4);
		let profitableChunks = 0;
		for (let i = 0; i < 4; i++) {
			const startVal = result.timeline[i * chunkSize]?.equity || 10000;
			const endVal = result.timeline[Math.min(result.timeline.length - 1, (i + 1) * chunkSize)]?.equity || startVal;
			if (endVal > startVal) {
				profitableChunks++;
			}
		}
		stability = profitableChunks / 4;
	} else {
		stability = 0.5;
	}

	const rawScore = expectancy * tradeCountFactor * (1 - riskOfRuin) * stability;
	return Math.max(0, parseFloat(rawScore.toFixed(4)));
}
