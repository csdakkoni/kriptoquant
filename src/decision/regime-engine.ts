// ============================================================================
// KRIPTOQUANT — Market Regime Engine (Sprint 29)
// ============================================================================

import { adx, atr, ema } from '../core/indicators/index.js';
import type { Candle } from '../core/types.js';

export type MarketRegime = 
	| 'TRENDING_BULL' 
	| 'TRENDING_BEAR' 
	| 'VOLATILE_RANGE' 
	| 'LOW_VOL_RANGE' 
	| 'BREAKOUT';

export interface RegimeDetails {
	regime: MarketRegime;
	adxVal: number;
	atrPercentile: number;
	emaSlope: 'positive' | 'negative' | 'flat';
}

export class MarketRegimeEngine {
	/**
	 * Mum verilerini analiz ederek piyasa rejimini (Market Regime) tespit eder.
	 */
	public detectRegime(candles: Candle[]): RegimeDetails {
		if (candles.length < 50) {
			return {
				regime: 'LOW_VOL_RANGE',
				adxVal: 15,
				atrPercentile: 0.5,
				emaSlope: 'flat'
			};
		}

		try {
			// 1) Compute ADX (14)
			const adxRes = adx(candles, 14);
			const lastAdx = adxRes.adx[adxRes.adx.length - 1];
			const adxVal = isNaN(lastAdx) ? 20 : lastAdx;

			// 2) Compute ATR (14)
			const atrValues = atr(candles, 14);
			const lastAtr = atrValues[atrValues.length - 1];

			// Compute rolling 30-period ATR percentile
			const recentAtrs = atrValues.slice(-30).filter(v => !isNaN(v));
			let atrPercentile = 0.5;
			if (recentAtrs.length > 0) {
				const smaller = recentAtrs.filter(v => v < lastAtr).length;
				atrPercentile = smaller / recentAtrs.length;
			}

			// 3) Compute EMA (20) slope
			const closes = candles.map(c => c.close);
			const ema20 = ema(closes, 20);
			const lastEma = ema20[ema20.length - 1];
			const prevEma = ema20[ema20.length - 2];
			
			let emaSlope: 'positive' | 'negative' | 'flat' = 'flat';
			const slopeThreshold = 0.0001 * lastEma; // 0.01% threshold
			const diff = lastEma - prevEma;

			if (diff > slopeThreshold) {
				emaSlope = 'positive';
			} else if (diff < -slopeThreshold) {
				emaSlope = 'negative';
			}

			// 4) Classification Rules
			let regime: MarketRegime = 'LOW_VOL_RANGE';

			if (atrPercentile > 0.90) {
				regime = 'BREAKOUT';
			} else if (adxVal > 25) {
				regime = emaSlope === 'positive' ? 'TRENDING_BULL' : 'TRENDING_BEAR';
			} else if (atrPercentile > 0.75) {
				regime = 'VOLATILE_RANGE';
			} else {
				regime = 'LOW_VOL_RANGE';
			}

			return {
				regime,
				adxVal: Math.round(adxVal),
				atrPercentile: parseFloat(atrPercentile.toFixed(2)),
				emaSlope
			};

		} catch (e) {
			return {
				regime: 'LOW_VOL_RANGE',
				adxVal: 20,
				atrPercentile: 0.5,
				emaSlope: 'flat'
			};
		}
	}
}
