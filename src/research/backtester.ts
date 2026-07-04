// ============================================================================
// KRIPTOQUANT — Backtest Wrapper (Sprint 11)
// ============================================================================
// Mevcut API'yi koruyan ince wrapper.
// İçerde SimulatedBroker + Execution Engine kullanır.
// Dış dünya için hiçbir şey değişmedi — aynı fonksiyon, aynı BacktestResult.
// ============================================================================

import type {
	BacktestResult,
	Candle,
	PlatformConfig,
	RiskConfig,
	StrategyDefaultsConfig,
	Strategy,
} from '../core/types.js';
import { SimulatedBroker } from '../execution/simulated-broker.js';
import { runExecution } from '../execution/engine.js';

/**
 * Backtest'i çalıştırır.
 *
 * Bu fonksiyon artık Execution Engine + SimulatedBroker'a delege eder.
 * API değişmedi — mevcut tüm çağrılar aynen çalışır.
 */
export function runBacktest(
	strategy: Strategy,
	candles: Candle[],
	config: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string = '',
	strategyDefaults?: StrategyDefaultsConfig,
	mcOptions?: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
	},
): BacktestResult {
	const broker = new SimulatedBroker(config.commissionPercent, config.slippagePercent);
	return runExecution(candles, strategy, broker, config, riskConfig, coin, strategyDefaults, undefined, mcOptions);
}
