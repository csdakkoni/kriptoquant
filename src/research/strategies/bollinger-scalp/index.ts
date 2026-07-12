// ============================================================================
// KRIPTOQUANT — Bollinger Scalp (Hızlı Mean Reversion)
// ============================================================================
// Amaç: Sık işlem açıp küçük kârları hızla realize eden kasa büyütücü.
// Kurallar:
// 1. LONG Giriş: Kapanış alt Bollinger Bandına değdiğinde (Close <= Lower).
//    Opsiyonel RSI guard: RSI(14) < rsiMax ise (0 = kapalı).
// 2. Çıkış: exitMode'a göre —
//    'middle': Kapanış orta banda (SMA20) dönünce SAT (hızlı kâr al, scalp)
//    'upper' : Kapanış üst banda ulaşınca SAT (klasik bollinger-bands davranışı)
// 3. SL: metadata.sl = Entry - 2*ATR (canlı motor ve backtest ile aynı çarpan).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { bollingerBands, atr, rsi } from '../../../core/indicators/index.js';

export function createBollingerScalpStrategy(
	bbPeriod: number = 20,
	bbMultiplier: number = 2,
	atrPeriod: number = 14,
	exitMode: 'middle' | 'upper' = 'middle',
	rsiMax: number = 0, // 0 = RSI filtresi kapalı
): Strategy {
	const name = exitMode === 'middle' ? 'bollinger-scalp' : 'bollinger-classic';
	return {
		name,
		description: `Bollinger Scalp (BB ${bbPeriod}/${bbMultiplier}, exit: ${exitMode}${rsiMax > 0 ? `, RSI<${rsiMax}` : ''})`,
		warmupPeriod: 30,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 30) return [];

			const closes = candles.map((c) => c.close);
			const bb = bollingerBands(closes, bbPeriod, bbMultiplier);
			const atrValues = atr(candles, atrPeriod);
			const rsiValues = rsiMax > 0 ? rsi(closes, 14) : [];

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = 30; i < candles.length; i++) {
				const current = candles[i];
				const lowerBand = bb.lower[i];
				const middleBand = bb.middle[i];
				const upperBand = bb.upper[i];
				const atrVal = atrValues[i];

				if (Number.isNaN(lowerBand) || Number.isNaN(middleBand) || Number.isNaN(upperBand) || Number.isNaN(atrVal)) {
					continue;
				}

				const rsiOk = rsiMax <= 0 || (!Number.isNaN(rsiValues[i]) && rsiValues[i] < rsiMax);
				const isBuySetup = current.close <= lowerBand && rsiOk;
				const exitLevel = exitMode === 'middle' ? middleBand : upperBand;
				const isSellSetup = current.close >= exitLevel;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					const slPrice = current.close - 2 * atrVal;
					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.75,
						reason: `BB Scalp BUY: Close <= Lower (${current.close.toFixed(4)} <= ${lowerBand.toFixed(4)})${rsiMax > 0 ? ` & RSI ${rsiValues[i].toFixed(1)} < ${rsiMax}` : ''}. SL = ${slPrice.toFixed(4)}`,
						metadata: { sl: slPrice, atr: atrVal },
					});
					lastSignalSide = 'BUY';
				} else if (isSellSetup && lastSignalSide === 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'SELL',
						price: current.close,
						confidence: 0.75,
						reason: `BB Scalp SELL: Close >= ${exitMode === 'middle' ? 'Middle' : 'Upper'} (${current.close.toFixed(4)} >= ${exitLevel.toFixed(4)})`,
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		},
	} as any;
}
