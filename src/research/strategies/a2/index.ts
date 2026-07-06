// ============================================================================
// KRIPTOQUANT — A2 15m Scalper Strategy (Sprint 29)
// ============================================================================
// Strateji Kuralları (15m Mumlar):
// 1. BUY:
//    - Close > EMA(20)
//    - Volume > SMA(20) of Volume * 1.0 (volumeMultiplier)
//    - RSI(14) <= 70
// 2. Position Size: Bakiyenin %25'i.
// 3. Automatic SL / TP:
//    - Stop Loss: -1% (Entry * 0.99)
//    - Take Profit: +3% (Entry * 1.03)
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { ema, rsi, sma } from '../../../core/indicators/index.js';

export function createA2Strategy(
	indicatorPeriod: number = 20,
	rsiPeriod: number = 14,
	volumeMultiplier: number = 1.0,
	stopLossRatio: number = 0.01,
	takeProfitRatio: number = 0.03
): Strategy {
	return {
		name: 'a2',
		description: 'A2 15m Scalper (EMA & RSI & Volume)',
		warmupPeriod: 50,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 50) return [];

			const closes = candles.map(c => c.close);
			const volumes = candles.map(c => c.volume);

			const ema20 = ema(closes, indicatorPeriod);
			const rsi14 = rsi(closes, rsiPeriod);
			const smaVolume20 = sma(volumes, indicatorPeriod);

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = 50; i < candles.length; i++) {
				const current = candles[i];
				
				const isAboveEma = current.close > ema20[i];
				const isHighVolume = current.volume > smaVolume20[i] * volumeMultiplier;
				const isNotOverbought = rsi14[i] <= 70;

				const isBuySetup = isAboveEma && isHighVolume && isNotOverbought;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.80,
						reason: `A2 BUY: Price > EMA20 (${current.close.toFixed(2)} > ${ema20[i].toFixed(2)}), Vol > SMA20 (${current.volume.toFixed(1)} > ${(smaVolume20[i]*volumeMultiplier).toFixed(1)}), RSI = ${rsi14[i].toFixed(1)}. SL = -1%, TP = +3%.`,
						metadata: { sl: current.close * (1 - stopLossRatio), tp: current.close * (1 + takeProfitRatio) }
					});
					lastSignalSide = 'BUY';
				} else if (!isBuySetup && lastSignalSide === 'BUY') {
					// In a2, exits are purely handled by SL/TP in the engine.
					// However, for backtest completeness we can exit if trend breaks (e.g. price drops below EMA20)
					if (current.close < ema20[i]) {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: current.close,
							confidence: 0.80,
							reason: `A2 Exit: Price broke below EMA20 (${current.close.toFixed(2)} < ${ema20[i].toFixed(2)}).`,
						});
						lastSignalSide = 'SELL';
					}
				}
			}

			return signals;
		}
	} as any;
}
