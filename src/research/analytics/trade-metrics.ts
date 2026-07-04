// ============================================================================
// KRIPTOQUANT — Trade Metrics Lab (Sprint 14)
// ============================================================================
// Tekil trade'lerin dağılımına ve özelliklerine dayalı metrikler.
// Expectancy (USDT, %, R), Kelly, SQN, MAE, MFE, Holding Time.
// ============================================================================

import type { Trade } from '../../core/types.js';

export interface TradeMetricsResult {
	readonly expectancyUsdt: number | string;
	readonly expectancyPercent: number | string;
	readonly expectancyR: number | string;
	readonly sqn: number | string;
	readonly kelly: number | string;
	readonly avgHoldingTimeMs: number;
	readonly avgMae: number;
	readonly avgMfe: number;
}

function stddev(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

export function calculateTradeMetrics(trades: Trade[]): TradeMetricsResult {
	const totalTrades = trades.length;

	if (totalTrades === 0) {
		return {
			expectancyUsdt: 0,
			expectancyPercent: 0,
			expectancyR: 0,
			sqn: 0,
			kelly: 0,
			avgHoldingTimeMs: 0,
			avgMae: 0,
			avgMfe: 0,
		};
	}

	const winningTrades = trades.filter((t) => t.pnl > 0);
	const losingTrades = trades.filter((t) => t.pnl <= 0);

	const winRate = winningTrades.length / totalTrades;
	const lossRate = 1 - winRate;

	const avgWinUsdt = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length : 0;
	const avgLossUsdt = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0)) / losingTrades.length : 0;

	const avgWinPercent = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnlPercent, 0) / winningTrades.length : 0;
	const avgLossPercent = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((s, t) => s + t.pnlPercent, 0)) / losingTrades.length : 0;

	// Calculate R-multiples for each trade
	const rMultiples: number[] = [];
	for (const t of trades) {
		const entryPrice = t.entryOrder.price;
		const exitPrice = t.exitOrder.price;
		const stopLossPrice = t.entryOrder.price - (t.atrAtEntry * 2.0); // Fallback stop loss using standard ATR 2.0 if not stored
		const initialRisk = entryPrice - stopLossPrice;
		
		let r = 0;
		if (initialRisk > 0) {
			r = (exitPrice - entryPrice) / initialRisk;
		}
		rMultiples.push(r);
	}

	const winningRs = rMultiples.filter((r) => r > 0);
	const losingRs = rMultiples.filter((r) => r <= 0);

	const avgWinR = winningRs.length > 0 ? winningRs.reduce((s, r) => s + r, 0) / winningRs.length : 0;
	const avgLossR = losingRs.length > 0 ? Math.abs(losingRs.reduce((s, r) => s + r, 0)) / losingRs.length : 0;

	// 1) Expectancy
	const expectancyUsdt = winRate * avgWinUsdt - lossRate * avgLossUsdt;
	const expectancyPercent = winRate * avgWinPercent - lossRate * avgLossPercent;
	const expectancyR = winRate * avgWinR - lossRate * avgLossR;

	// 2) Kelly Fraction (Requires min 30 trades for reliability)
	let kelly: number | string = 'Insufficient Sample (< 30 trades)';
	if (totalTrades >= 30) {
		const ratio = avgLossPercent > 0 ? avgWinPercent / avgLossPercent : 0;
		if (ratio > 0) {
			kelly = winRate - lossRate / ratio;
		} else {
			kelly = 0;
		}
	}

	// 3) SQN (Requires min 30 trades for reliability)
	let sqn: number | string = 'Insufficient Sample (< 30 trades)';
	if (totalTrades >= 30) {
		const meanR = rMultiples.reduce((s, r) => s + r, 0) / totalTrades;
		const stdR = stddev(rMultiples);
		sqn = stdR > 0 ? (meanR / stdR) * Math.sqrt(totalTrades) : 0;
	}

	// 4) Average Holding Time
	const avgHoldingTimeMs = trades.reduce((s, t) => s + t.holdingPeriod, 0) / totalTrades;

	// 5) MAE / MFE
	const maes = trades.map((t) => t.mae ?? 0);
	const mfes = trades.map((t) => t.mfe ?? 0);
	const avgMae = maes.reduce((s, v) => s + v, 0) / totalTrades;
	const avgMfe = mfes.reduce((s, v) => s + v, 0) / totalTrades;

	return {
		expectancyUsdt: round(expectancyUsdt, 2),
		expectancyPercent: round(expectancyPercent, 2),
		expectancyR: round(expectancyR, 2),
		sqn: typeof sqn === 'number' ? round(sqn, 2) : sqn,
		kelly: typeof kelly === 'number' ? round(kelly, 4) : kelly,
		avgHoldingTimeMs: Math.round(avgHoldingTimeMs),
		avgMae: round(avgMae, 2),
		avgMfe: round(avgMfe, 2),
	};
}

function round(val: number, precision: number = 2): number {
	const factor = 10 ** precision;
	return Math.round(val * factor) / factor;
}
