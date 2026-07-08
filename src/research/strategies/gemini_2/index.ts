// ============================================================================
// KRIPTOQUANT — Gemini 2: Adaptive Trend Follower (Sprint 30)
// ============================================================================
// Strateji Kuralları:
// 1) Trend Yönü (VWAP Filtresi): Fiyat, rolling VWAP (20) değerinin üzerinde olmalı.
// 2) Momentum Hızlanması (MACD Histogram): MACD Histogramı pozitif (>0) olmalı 
//    ve bir önceki muma göre yükselmiş olmalı (> histogram[i-1]) (boğa ivmesi).
// 3) Trend Gücü (ADX Filtresi): ADX (14) değeri 22'den büyük olmalı (güçlü trend).
// 4) Çıkış Kuralları:
//    - Stop Loss: ATR (14) indikatörünün 2.0 katı mesafe kadar altına yerleştirilir (SL = Entry - 2 * ATR).
//    - Take Profit: Risk mesafesinin 3.0 katı (1:3 R/R).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { macd, adx, vwap, atr } from '../../../core/indicators/index.js';

export function createGemini2Strategy(): Strategy {
	return {
		name: 'gemini_2',
		description: 'Gemini 2: Adaptive Trend Follower (VWAP + MACD Histogram Acceleration + ADX Trend)',
		warmupPeriod: 50,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 50) return [];

			const closes = candles.map(c => c.close);
			const vwapValues = vwap(candles, 20);
			const macdResult = macd(closes, 12, 26, 9);
			const adxResult = adx(candles, 14);
			const atrValues = atr(candles, 14);

			let inPosition = false;
			let entryPrice = 0;
			let stopLossPrice = 0;
			let takeProfitPrice = 0;

			for (let i = 30; i < candles.length; i++) {
				const current = candles[i];
				const vwapVal = vwapValues[i];
				const hist = macdResult.histogram[i];
				const prevHist = macdResult.histogram[i - 1];
				const adxVal = adxResult.adx[i];
				const atrVal = atrValues[i];

				if (Number.isNaN(vwapVal) || Number.isNaN(hist) || Number.isNaN(prevHist) || Number.isNaN(adxVal) || Number.isNaN(atrVal)) {
					continue;
				}

				if (inPosition) {
					// Exit checking (Simulated for backtests)
					if (current.low <= stopLossPrice) {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: stopLossPrice,
							confidence: 1.0,
							reason: 'Stop Loss Hit (ATR Stop)',
						});
						inPosition = false;
						continue;
					}
					if (current.high >= takeProfitPrice) {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: takeProfitPrice,
							confidence: 1.0,
							reason: 'Take Profit Hit (1:3 R/R)',
						});
						inPosition = false;
						continue;
					}
				}

				// Entry Check
				if (!inPosition) {
					const isAboveVwap = current.close > vwapVal;
					const isMacdAccelerating = hist > 0 && hist > prevHist;
					const isStrongTrend = adxVal > 22;

					if (isAboveVwap && isMacdAccelerating && isStrongTrend) {
						entryPrice = current.close;
						const risk = atrVal * 2.0;

						if (risk > 0) {
							stopLossPrice = entryPrice - risk;
							takeProfitPrice = entryPrice + (risk * 3.0); // 1:3 R/R

							signals.push({
								timestamp: current.openTime,
								side: 'BUY',
								price: entryPrice,
								confidence: 1.0,
								stopLoss: stopLossPrice,
								takeProfit: takeProfitPrice,
								reason: `GEMINI 2 BUY: Price ($${current.close.toFixed(4)}) > VWAP ($${vwapVal.toFixed(4)}), MACD Hist rising (${hist.toFixed(4)} > ${prevHist.toFixed(4)}), ADX Trend Strong (${adxVal.toFixed(2)} > 22). SL: $${stopLossPrice.toFixed(4)} (2x ATR) | TP: $${takeProfitPrice.toFixed(4)}`,
							});
							inPosition = true;
						}
					}
				}
			}

			return signals;
		}
	};
}
