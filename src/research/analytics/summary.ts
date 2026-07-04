// ============================================================================
// KRIPTOQUANT — Analytics Summary Integrator (Sprint 14)
// ============================================================================
// Trade ve Equity metriklerini derler ve BacktestResult.analytics objesini doldurur.
// Monte Carlo için trade dağılımlarını hazırlar.
// ============================================================================

import type { Trade, EquityPoint, Candle, BacktestResult } from '../../core/types.js';
import { calculateTradeMetrics } from './trade-metrics.js';
import { calculateEquityMetrics } from './equity-metrics.js';

export function buildAnalyticsSummary(
	equityCurve: EquityPoint[],
	trades: Trade[],
	candles: Candle[],
	initialCapital: number,
	finalCapital: number,
	maxDrawdown: number,
): NonNullable<BacktestResult['analytics']> {
	const tradeMetrics = calculateTradeMetrics(trades);
	const equityMetrics = calculateEquityMetrics(
		equityCurve,
		trades,
		candles,
		initialCapital,
		finalCapital,
		maxDrawdown,
	);

	// Distributions: Monte Carlo veya grafikler için ham histogram verileri
	const returns = trades.map((t) => t.pnlPercent);
	const durations = trades.map((t) => t.holdingPeriod / 3600000); // Saat cinsinden
	const drawdowns = equityCurve.map((ep) => ep.drawdownPercent);

	return {
		expectancyUsdt: tradeMetrics.expectancyUsdt,
		expectancyPercent: tradeMetrics.expectancyPercent,
		expectancyR: tradeMetrics.expectancyR,
		sqn: tradeMetrics.sqn,
		kelly: tradeMetrics.kelly,
		exposureTime: equityMetrics.exposureTime,
		capitalUsage: equityMetrics.capitalUsage,
		recoveryFactor: equityMetrics.recoveryFactor,
		ulcerIndex: equityMetrics.ulcerIndex,
		marRatio: equityMetrics.marRatio,
		gainPainRatio: equityMetrics.gainPainRatio,
		distributions: {
			returns,
			durations,
			drawdowns,
		},
	};
}
