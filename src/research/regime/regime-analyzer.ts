// ============================================================================
// KRIPTOQUANT — Market Regime Analyzer (Sprint 15)
// ============================================================================
// İşlemleri rejimlere göre gruplar, coverage hesaplar ve öneriler üretir.
// ============================================================================

import type { Trade, Candle } from '../../core/types.js';
import type { RegimeClassifier } from './types.js';
import { round } from '../../core/utils.js';

export interface RegimeStats {
	readonly regimeKey: string;
	readonly datasetCoveragePercent: number; // Mumlarda geçirdiği süre %
	readonly tradeCount: number;
	readonly tradePercent: number; // Toplam işlemlerdeki payı %
	readonly winRate: number; // %
	readonly totalReturn: number; // %
	readonly profitFactor: number;
	readonly avgReturn: number; // %
	readonly recommendation: 'ENABLE' | 'DISABLE' | 'NEUTRAL';
}

export interface MarketRegimeReport {
	readonly stats: RegimeStats[];
}

const REGIME_KEYS = [
	'BULL_HIGH',
	'BULL_LOW',
	'BEAR_HIGH',
	'BEAR_LOW',
	'SIDEWAYS_HIGH',
	'SIDEWAYS_LOW',
];

export function analyzeRegimes(
	trades: Trade[],
	candles: Candle[],
	classifier: RegimeClassifier,
): MarketRegimeReport {
	const regimes = classifier.classify(candles);
	const totalCandles = candles.length;
	const totalTrades = trades.length;

	// 1) Her mum için timestamp -> regime haritası çıkar
	const regimeMap = new Map<number, string>();
	const coverageCounts: Record<string, number> = {};
	for (const key of REGIME_KEYS) {
		coverageCounts[key] = 0;
	}

	for (let i = 0; i < totalCandles; i++) {
		const c = candles[i];
		const r = regimes[i];
		const key = `${r.trend}_${r.volatility}`;
		regimeMap.set(c.openTime, key);

		if (key in coverageCounts) {
			coverageCounts[key]++;
		}
	}

	// 2) İşlemleri rejimlerine göre grupla
	const tradesByRegime: Record<string, Trade[]> = {};
	for (const key of REGIME_KEYS) {
		tradesByRegime[key] = [];
	}

	for (const t of trades) {
		const key = regimeMap.get(t.entryOrder.timestamp) ?? 'SIDEWAYS_LOW';
		if (key in tradesByRegime) {
			tradesByRegime[key].push(t);
		}
	}

	// 3) Her rejim için istatistikleri hesapla
	const stats: RegimeStats[] = [];

	for (const key of REGIME_KEYS) {
		const regimeTrades = tradesByRegime[key];
		const coverageCount = coverageCounts[key];
		const datasetCoveragePercent = totalCandles > 0 ? (coverageCount / totalCandles) * 100 : 0;

		const tradeCount = regimeTrades.length;
		const tradePercent = totalTrades > 0 ? (tradeCount / totalTrades) * 100 : 0;

		const winningTrades = regimeTrades.filter((t) => t.pnl > 0);
		const winRate = tradeCount > 0 ? (winningTrades.length / tradeCount) * 100 : 0;

		const totalReturn = regimeTrades.reduce((sum, t) => sum + t.pnlPercent, 0);
		const avgReturn = tradeCount > 0 ? totalReturn / tradeCount : 0;

		// Profit Factor
		const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
		const grossLoss = Math.abs(regimeTrades.filter((t) => t.pnl <= 0).reduce((sum, t) => sum + t.pnl, 0));
		const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

		// Tavsiyeler
		let recommendation: 'ENABLE' | 'DISABLE' | 'NEUTRAL' = 'NEUTRAL';
		if (tradeCount >= 3) {
			if (profitFactor >= 1.5 && totalReturn > 0) {
				recommendation = 'ENABLE';
			} else if (profitFactor < 1.0 || totalReturn < 0) {
				recommendation = 'DISABLE';
			}
		}

		stats.push({
			regimeKey: key,
			datasetCoveragePercent: round(datasetCoveragePercent, 2),
			tradeCount,
			tradePercent: round(tradePercent, 2),
			winRate: round(winRate, 2),
			totalReturn: round(totalReturn, 2),
			profitFactor: profitFactor === 999 ? 999 : round(profitFactor, 2),
			avgReturn: round(avgReturn, 2),
			recommendation,
		});
	}

	return { stats };
}
