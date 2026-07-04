// ============================================================================
// KRIPTOQUANT — Experiment Runner (Sprint 7)
// ============================================================================
// Tek bir parametre kombinasyonunu backtest'e dönüştüren saf fonksiyon.
// Yan etkisi yok. Worker thread'lerde güvenle çalıştırılabilir.
// ============================================================================

import type {
	Candle,
	PlatformConfig,
	RiskConfig,
	StrategyDefaultsConfig,
} from '../../core/types.js';
import { runBacktest } from '../backtester.js';
import { createEmaCrossStrategy } from '../strategies/ema-cross/index.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface ExperimentParams {
	readonly emaFast: number;
	readonly emaSlow: number;
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
	readonly emaFast: number[];
	readonly emaSlow: number[];
	readonly adxVetoThreshold: number[];
	readonly rvolVetoThreshold: number[];
	readonly minimumConfidence: number[];
}

// ─── Varsayılan Sweep Parametreleri ──────────────────────────────────────────

export const DEFAULT_SWEEP: SweepConfig = {
	emaFast: [5, 7, 9, 12, 15],
	emaSlow: [20, 30, 50],
	adxVetoThreshold: [15, 20, 25, 30],
	rvolVetoThreshold: [1.2, 1.5, 2.0],
	minimumConfidence: [60, 70, 80],
};

// ─── Kombinasyon Üretici ─────────────────────────────────────────────────────

/**
 * Tüm parametre kombinasyonlarını oluşturur.
 * emaFast >= emaSlow olan geçersiz kombinasyonları otomatik atlar.
 */
export function generateCombinations(config: SweepConfig): ExperimentParams[] {
	const combinations: ExperimentParams[] = [];

	for (const emaFast of config.emaFast) {
		for (const emaSlow of config.emaSlow) {
			if (emaFast >= emaSlow) continue;

			for (const adx of config.adxVetoThreshold) {
				for (const rvol of config.rvolVetoThreshold) {
					for (const conf of config.minimumConfidence) {
						combinations.push({
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
	const strategy = createEmaCrossStrategy(params.emaFast, params.emaSlow);

	const strategyDefaults: StrategyDefaultsConfig = {
		strategies: {
			emaCross: { fast: params.emaFast, slow: params.emaSlow },
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
