// ============================================================================
// KRIPTOQUANT — A2 Bollinger Bands v2 (Oynaklık Tabanlı & Trailing Stop)
// ============================================================================
// Strateji Kuralları:
// 1. Giriş Filtresi (ADX < 25): Sadece yatay veya trend bulunmayan piyasalar.
// 2. LONG Giriş: Fiyat alt Bollinger Bandına değdiğinde (Price <= Lower Band).
// 3. Çıkış: ATR tabanlı dinamik Trailing Stop (Engine tarafında yönetilir).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { bollingerBands, atr, adx } from '../../../core/indicators/index.js';

export function createA2V2Strategy(
	bbPeriod: number = 20,
	bbMultiplier: number = 2,
	atrPeriod: number = 14,
	adxPeriod: number = 14
): Strategy {
	return {
		name: 'a2-v2',
		description: 'A2 Bollinger Bands v2 (Oynaklık Tabanlı & Trailing Stop)',
		warmupPeriod: 50,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 50) return [];

			const closes = candles.map(c => c.close);
			const bb = bollingerBands(closes, bbPeriod, bbMultiplier);
			const atrValues = atr(candles, atrPeriod);
			const adxResult = adx(candles, adxPeriod);

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = 50; i < candles.length; i++) {
				const current = candles[i];
				const adxVal = adxResult.adx[i];
				const atrVal = atrValues[i];
				const lowerBand = bb.lower[i];
				const upperBand = bb.upper[i];

				if (Number.isNaN(lowerBand) || Number.isNaN(upperBand) || Number.isNaN(adxVal) || Number.isNaN(atrVal)) {
					continue;
				}

				const isBuySetup = current.close <= lowerBand && adxVal < 25;
				// Karşıt sinyali hala sisteme basıyoruz ama live-engine bunu yoksayıp trailing stop'u bekleyecek
				const isSellSetup = current.close >= upperBand;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					const slPrice = current.close - 2 * atrVal;
					const tpPrice = 0; // Trailing stop ile kar maksimizasyonu hedeflendiği için hedef sınırsız

					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.88,
						reason: `A2 V2 BUY: Price <= Lower Band (${current.close.toFixed(4)} <= ${lowerBand.toFixed(4)}) & ADX = ${adxVal.toFixed(1)} < 25. ATR = ${atrVal.toFixed(4)}. SL = ${slPrice.toFixed(4)}.`,
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
						confidence: 0.88,
						reason: `A2 V2 SELL (Opposite Signal - For Info Only): Price >= Upper Band (${current.close.toFixed(4)} >= ${upperBand.toFixed(4)}).`
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
