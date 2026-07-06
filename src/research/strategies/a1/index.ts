// ============================================================================
// KRIPTOQUANT — A1 High-Frequency Scalping Strategy (Sprint 29)
// ============================================================================
// Strateji Kuralları:
// 1. Core: EMA 21, EMA 50, VWAP ve HTF (15m) Trend Filtresi.
// 2. Module A (Liquidity Sweep): Son 15 mumun en düşük/yüksek seviyelerinin 
//    altına/üstüne iğne atıp (stop hunt) tekrar kanal içine dönen mumlarda işlem.
// 3. Module B (Breakout): 15m trend yönünde ve VWAP üzerinde konsolidasyon kırılımları.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { ema } from '../../../core/indicators/index.js';

export function createA1Strategy(
	swingPeriod: number = 15,
	consolidationPeriod: number = 10,
	consolidationThreshold: number = 0.005 // 0.5% max range width
): Strategy {
	return {
		name: 'a1',
		description: 'A1 Scalper (Sweep & Breakout)',
		warmupPeriod: 250, // Requires EMA 250 for HTF emulation

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 250) return [];

			// Calculate indicator values over closes
			const closes = candles.map(c => c.close);
			const ema21 = ema(closes, 21);
			const ema50 = ema(closes, 50);
			
			// Emulate 15m HTF Trend on 3m/5m candles using scale mapping (5x period multiplier)
			const emaHtfFast = ema(closes, 105); // 21 * 5
			const emaHtfSlow = ema(closes, 250); // 50 * 5

			// Calculate Intraday VWAP (Rolling 100-period for local session VWAP representation)
			const vwap: number[] = new Array(candles.length).fill(0);
			let rollingSumPV = 0;
			let rollingSumV = 0;
			const vwapWindow = 100;

			for (let i = 0; i < candles.length; i++) {
				const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3.0;
				rollingSumPV += typicalPrice * candles[i].volume;
				rollingSumV += candles[i].volume;

				if (i >= vwapWindow) {
					const oldTP = (candles[i - vwapWindow].high + candles[i - vwapWindow].low + candles[i - vwapWindow].close) / 3.0;
					rollingSumPV -= oldTP * candles[i - vwapWindow].volume;
					rollingSumV -= candles[i - vwapWindow].volume;
				}

				vwap[i] = rollingSumV > 0 ? (rollingSumPV / rollingSumV) : candles[i].close;
			}

			// Durum takibi: mükerrer sinyalleri engellemek için aktif yön kontrolü
			let currentDirection: 'LONG' | 'SHORT' | null = null;

			for (let i = 250; i < candles.length; i++) {
				const current = candles[i];
				const prev = candles[i - 1];

				// --- 1. HIGHER TIMEFRAME (HTF) TREND FILTER ---
				const isHtfBullish = current.close > emaHtfFast[i] && emaHtfFast[i] > emaHtfSlow[i];
				const isHtfBearish = current.close < emaHtfFast[i] && emaHtfFast[i] < emaHtfSlow[i];
				const isAboveVwap = current.close > vwap[i];
				const isBelowVwap = current.close < vwap[i];

				// --- 2. MODULE A: LIQUIDITY SWEEP (STOP HUNT) ---
				// Find swing high/low of the recent swingPeriod
				let swingLow = Infinity;
				let swingHigh = -Infinity;
				for (let j = i - swingPeriod; j < i; j++) {
					if (candles[j].low < swingLow) swingLow = candles[j].low;
					if (candles[j].high > swingHigh) swingHigh = candles[j].high;
				}

				// Long: Price swept swingLow but closed above it
				const isLongSweep = current.low < swingLow && current.close > swingLow;
				// Short: Price swept swingHigh but closed below it
				const isShortSweep = current.high > swingHigh && current.close < swingHigh;

				if (isLongSweep && currentDirection !== 'LONG') {
					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.90,
						reason: `Module A: Liquidity Sweep below ${swingLow.toFixed(2)}. SL placed 1 tick below wick low (${(current.low - 0.1).toFixed(2)}).`,
						metadata: { sl: current.low - 0.1, tp: current.close + 2 * (current.close - current.low) }
					});
					currentDirection = 'LONG';
					continue;
				}

				if (isShortSweep && currentDirection !== 'SHORT') {
					signals.push({
						timestamp: current.openTime,
						side: 'SELL',
						price: current.close,
						confidence: 0.90,
						reason: `Module A: Liquidity Sweep above ${swingHigh.toFixed(2)}. SL placed 1 tick above wick high (${(current.high + 0.1).toFixed(2)}).`,
						metadata: { sl: current.high + 0.1, tp: current.close - 2 * (current.high - current.close) }
					});
					currentDirection = 'SHORT';
					continue;
				}

				// --- 3. MODULE B: BREAKOUT & RETEST (TREND FOLLOWING) ---
				// Detect consolidation zone width
				let structureLow = Infinity;
				let structureHigh = -Infinity;
				for (let j = i - consolidationPeriod; j < i; j++) {
					if (candles[j].low < structureLow) structureLow = candles[j].low;
					if (candles[j].high > structureHigh) structureHigh = candles[j].high;
				}
				const structureWidth = (structureHigh - structureLow) / current.close;

				if (structureWidth < consolidationThreshold) {
					// Bullish Breakout: 15m Trend is Bullish + Price above VWAP + Breakout close above structureHigh
					const isBullishBreakout = isHtfBullish && isAboveVwap && prev.close <= structureHigh && current.close > structureHigh;
					// Bearish Breakout: 15m Trend is Bearish + Price below VWAP + Breakout close below structureLow
					const isBearishBreakout = isHtfBearish && isBelowVwap && prev.close >= structureLow && current.close < structureLow;

					if (isBullishBreakout && currentDirection !== 'LONG') {
						signals.push({
							timestamp: current.openTime,
							side: 'BUY',
							price: current.close,
							confidence: 0.85,
							reason: `Module B: Consolidation Breakout above ${structureHigh.toFixed(2)} (Width: ${(structureWidth*100).toFixed(2)}%). Trend is Bullish.`,
							metadata: { sl: structureLow, tp: current.close + 2 * (current.close - structureLow) }
						});
						currentDirection = 'LONG';
						continue;
					}

					if (isBearishBreakout && currentDirection !== 'SHORT') {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: current.close,
							confidence: 0.85,
							reason: `Module B: Consolidation Breakout below ${structureLow.toFixed(2)} (Width: ${(structureWidth*100).toFixed(2)}%). Trend is Bearish.`,
							metadata: { sl: structureHigh, tp: current.close - 2 * (structureHigh - current.close) }
						});
						currentDirection = 'SHORT';
						continue;
					}
				}
			}

			return signals;
		}
	} as any;
}
