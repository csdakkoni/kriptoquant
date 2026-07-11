// ============================================================================
// KRIPTOQUANT — Bollinger Bands v2 (Dinamik Stop & Kademeli Kar Al)
// ============================================================================
// Strateji Kuralları:
// 1. LONG Giriş: Fiyat alt Bollinger Bandının altına sarktığında (Price <= Lower Band).
// 2. Dinamik SL: 2 * ATR bandı koruması (metadata.sl olarak iletilir).
// 3. Karşıt Çıkış: Fiyat üst Bollinger Bandına ulaştığında (Price >= Upper Band).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { bollingerBands, atr } from '../../../core/indicators/index.js';

export function createBollingerBandsV2Strategy(
	bbPeriod: number = 20,
	bbMultiplier: number = 2,
	atrPeriod: number = 14
): Strategy {
	return {
		name: 'bollinger-bands-v2',
		description: 'Bollinger Bands v2 (Dinamik & Kademeli Kar Al)',
		warmupPeriod: 30,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 30) return [];

			const closes = candles.map(c => c.close);
			const bb = bollingerBands(closes, bbPeriod, bbMultiplier);
			const atrValues = atr(candles, atrPeriod);

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = 30; i < candles.length; i++) {
				const current = candles[i];
				const lowerBand = bb.lower[i];
				const upperBand = bb.upper[i];
				const atrVal = atrValues[i];

				if (Number.isNaN(lowerBand) || Number.isNaN(upperBand) || Number.isNaN(atrVal)) {
					continue;
				}

				const isBuySetup = current.close <= lowerBand;
				const isSellSetup = current.close >= upperBand;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					const slPrice = current.close - 2 * atrVal;
					const tpPrice = current.close + 4 * atrVal; // Standard ceiling target

					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.80,
						reason: `BB V2 BUY: Price <= Lower Band (${current.close.toFixed(4)} <= ${lowerBand.toFixed(4)}). ATR = ${atrVal.toFixed(4)}. SL (2*ATR) = ${slPrice.toFixed(4)}.`,
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
						confidence: 0.80,
						reason: `BB V2 SELL: Price >= Upper Band (${current.close.toFixed(4)} >= ${upperBand.toFixed(4)}).`
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
