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
	};
}
