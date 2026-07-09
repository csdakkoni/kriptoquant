// ============================================================================
// KRIPTOQUANT — VWAP Mean Reversion Strategy
// ============================================================================
// Strateji Kuralları:
// 1. Giriş Filtresi (ADX < 25): Sadece yatay veya trend bulunmayan piyasalar.
// 2. LONG Giriş: Fiyat VWAP Z-Score alt eşiğine ulaştığında (Z-Score <= -2.5).
// 3. Çıkış (Kâr Al): Fiyat ortadaki adil değer olan VWAP çizgisine ulaştığında.
// 4. Stop Loss: Girişteki oynaklığa göre ATR tabanlı dinamik stop (Entry - 2 * ATR).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { vwap, vwapZScore } from '../../../core/indicators/vwap.js';
import { atr, adx } from '../../../core/indicators/index.js';

export function createVwapReversionStrategy(
	vwapPeriod: number = 96, // 15m * 96 = 24 saatlik kayan pencere
	zScoreThreshold: number = -2.5,
	atrPeriod: number = 14,
	adxPeriod: number = 14
): Strategy {
	return {
		name: 'vwap-reversion',
		description: 'VWAP Mean Reversion (Z-Score & ADX Filtreli)',
		warmupPeriod: vwapPeriod + 10,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			const warmup = vwapPeriod + 10;
			if (candles.length < warmup) return [];

			const zScores = vwapZScore(candles, vwapPeriod);
			const vwaps = vwap(candles, vwapPeriod);
			const atrValues = atr(candles, atrPeriod);
			const adxResult = adx(candles, adxPeriod);

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = warmup; i < candles.length; i++) {
				const current = candles[i];
				const zScore = zScores[i];
				const currentVwap = vwaps[i];
				const atrVal = atrValues[i];
				const adxVal = adxResult.adx[i];

				if (Number.isNaN(zScore) || Number.isNaN(currentVwap) || Number.isNaN(atrVal) || Number.isNaN(adxVal)) {
					continue;
				}

				const isBuySetup = zScore <= zScoreThreshold && adxVal < 25;
				const isSellSetup = current.close >= currentVwap;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					const slPrice = current.close - 2 * atrVal;
					const tpPrice = currentVwap;

					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.90,
						reason: `VWAP BUY: Z-Score <= ${zScoreThreshold} (${zScore.toFixed(2)}) & ADX = ${adxVal.toFixed(1)} < 25. ATR = ${atrVal.toFixed(4)}. SL = ${slPrice.toFixed(4)}, TP = ${tpPrice.toFixed(4)}.`,
						metadata: {
							sl: slPrice,
							tp: tpPrice,
							atr: atrVal
						}
					});
					lastSignalSide = 'BUY';
				} else if (isSellSetup && lastSignalSide === 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'SELL',
						price: current.close,
						confidence: 0.90,
						reason: `VWAP SELL (Mean Reverted): Price >= VWAP (${current.close.toFixed(4)} >= ${currentVwap.toFixed(4)}).`
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
