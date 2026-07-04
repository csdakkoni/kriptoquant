// ============================================================================
// KRIPTOQUANT — Market Regime Types (Sprint 15)
// ============================================================================

import type { Candle } from '../../core/types.js';

export type TrendRegime = 'BULL' | 'BEAR' | 'SIDEWAYS';
export type VolatilityRegime = 'LOW' | 'HIGH';

export interface MarketRegime {
	readonly trend: TrendRegime;
	readonly volatility: VolatilityRegime;
}

export interface RegimeClassifier {
	/**
	 * Mum listesini analiz ederek her mum dizini için bir piyasa rejimi üretir.
	 *
	 * @param candles - Analiz edilecek mum serisi
	 * @returns Mum sayısıyla aynı boyutta rejim dizisi
	 */
	classify(candles: Candle[]): MarketRegime[];
}
