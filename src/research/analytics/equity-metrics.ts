// ============================================================================
// KRIPTOQUANT — Equity Metrics Lab (Sprint 14)
// ============================================================================
// Equity curve (zaman serisi) bazlı risk ve getiri metrikleri.
// Ulcer Index, Exposure (Time & Capital), MAR, Recovery Factor, Gain/Pain.
// ============================================================================

import type { Trade, EquityPoint, Candle } from '../../core/types.js';

export interface EquityMetricsResult {
	readonly ulcerIndex: number;
	readonly exposureTime: number; // %
	readonly capitalUsage: number; // %
	readonly recoveryFactor: number;
	readonly marRatio: number;
	readonly gainPainRatio: number;
}

export function calculateEquityMetrics(
	equityCurve: EquityPoint[],
	trades: Trade[],
	candles: Candle[],
	initialCapital: number,
	finalCapital: number,
	maxDrawdown: number,
): EquityMetricsResult {
	if (equityCurve.length === 0) {
		return {
			ulcerIndex: 0,
			exposureTime: 0,
			capitalUsage: 0,
			recoveryFactor: 0,
			marRatio: 0,
			gainPainRatio: 0,
		};
	}

	// 1) Ulcer Index: Drawdown'ların karesel ortalamasının karekökü
	const drawdowns = equityCurve.map((ep) => ep.drawdownPercent);
	const sumSqDrawdown = drawdowns.reduce((sum, dd) => sum + dd ** 2, 0);
	const ulcerIndex = drawdowns.length > 0 ? Math.sqrt(sumSqDrawdown / drawdowns.length) : 0;

	// 2) Exposure Time %: Pozisyonda kalınan sürenin tüm süreye oranı
	let exposureTime = 0;
	if (candles.length > 1 && trades.length > 0) {
		const totalActiveTime = trades.reduce((sum, t) => sum + t.holdingPeriod, 0);
		const firstCandle = candles[0];
		const lastCandle = candles[candles.length - 1];
		const totalTime = lastCandle.closeTime - firstCandle.openTime;
		exposureTime = totalTime > 0 ? (totalActiveTime / totalTime) * 100 : 0;
	}

	// 3) Capital Usage %: Ortalama pozisyon büyüklüğünün sermayeye oranı
	let capitalUsage = 0;
	if (trades.length > 0) {
		const usages = trades.map((t) => (t.positionSize / initialCapital) * 100);
		capitalUsage = usages.reduce((sum, u) => sum + u, 0) / trades.length;
	}

	// 4) Recovery Factor: Net Kar / Max Drawdown % (veya nominal)
	const netProfit = finalCapital - initialCapital;
	const recoveryFactor = maxDrawdown > 0 ? netProfit / (initialCapital * (maxDrawdown / 100)) : 0;

	// 5) MAR Ratio: Toplam Getiri / Max Drawdown
	const totalReturn = (netProfit / initialCapital) * 100;
	const marRatio = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

	// 6) Gain/Pain Ratio: Toplam Kazançlar / Toplam Kayıpların Mutlak Değeri (Trade bazlı)
	const winningTrades = trades.filter((t) => t.pnl > 0);
	const losingTrades = trades.filter((t) => t.pnl <= 0);
	const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
	const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
	const gainPainRatio = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

	return {
		ulcerIndex: round(ulcerIndex, 2),
		exposureTime: round(Math.min(100, exposureTime), 2),
		capitalUsage: round(Math.min(100, capitalUsage), 2),
		recoveryFactor: round(recoveryFactor, 2),
		marRatio: round(marRatio, 2),
		gainPainRatio: gainPainRatio === Infinity ? 999 : round(gainPainRatio, 2),
	};
}

function round(val: number, precision: number = 2): number {
	const factor = 10 ** precision;
	return Math.round(val * factor) / factor;
}
