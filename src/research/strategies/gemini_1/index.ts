// ============================================================================
// KRIPTOQUANT — Gemini 1: Liquidity Sweep & Volume Exhaustion (Sprint 30)
// ============================================================================
// Strateji Kuralları:
// 1) Likidite Avı (Liquidity Sweep): 15M mumunun en düşüğü, son 20 mumun en 
//    düşük seviyesini delmeli (fakat altında kapatmamalı, geri dönmeli).
// 2) Mum Yapısı (Bullish Pinbar / Exhaustion): Mum yeşil kapatmalı ve alt fitili 
//    (lower wick) gövdesinin en az 1.5 katı olmalı (kurumsal alım baskısı).
// 3) Hacim Patlaması (Volume Climax): Bu dönüş mumunun hacmi, son 20 mumun 
//    ortalama hacminin en az 1.8 katı olmalı (tükeniş hacmi).
// 4) Çıkış Kuralları:
//    - Stop Loss: Giriş mumunun en düşüğü (Swing Low).
//    - Take Profit: Risk mesafesinin 2.5 katı (1:2.5 R/R).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { sma } from '../../../core/indicators/index.js';

export function createGemini1Strategy(): Strategy {
	return {
		name: 'gemini_1',
		description: 'Gemini 1: Liquidity Sweep & Volume Exhaustion Reversal (SMC)',
		warmupPeriod: 50,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 50) return [];

			const volumes = candles.map(c => c.volume);
			const volSma20 = sma(volumes, 20);

			let inPosition = false;
			let entryPrice = 0;
			let stopLossPrice = 0;
			let takeProfitPrice = 0;

			for (let i = 25; i < candles.length; i++) {
				const current = candles[i];
				const vSma = volSma20[i];

				if (Number.isNaN(vSma)) continue;

				if (inPosition) {
					// Exit checking (Simulated for backtests)
					if (current.low <= stopLossPrice) {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: stopLossPrice,
							confidence: 1.0,
							reason: 'Stop Loss Hit (Exhaustion Low)',
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
							reason: 'Take Profit Hit (1:2.5 R/R)',
						});
						inPosition = false;
						continue;
					}
				}

				// Entry Check
				if (!inPosition) {
					// 1. Find previous 20-candle lowest low (excluding current candle)
					const recent20 = candles.slice(i - 20, i);
					const lowestLow20 = Math.min(...recent20.map(c => c.low));

					// Liquidity Sweep check: current low must pierce lowestLow20, but close must be higher
					const didSweep = current.low < lowestLow20 && current.close > lowestLow20;

					// 2. Pinbar structure check
					const body = Math.abs(current.close - current.open);
					const lowerWick = Math.min(current.open, current.close) - current.low;
					const upperWick = current.high - Math.max(current.open, current.close);
					const isGreen = current.close > current.open;

					const isBullishPinbar = isGreen && body > 0 && lowerWick >= (body * 1.5) && upperWick < (body * 0.5);

					// 3. Volume Climax check
					const hasVolumeClimax = current.volume > (vSma * 1.8);

					if (didSweep && isBullishPinbar && hasVolumeClimax) {
						entryPrice = current.close;
						stopLossPrice = current.low; // Stop just below the swept low
						const risk = entryPrice - stopLossPrice;

						if (risk > 0) {
							takeProfitPrice = entryPrice + (risk * 2.5); // 1:2.5 R/R
							signals.push({
								timestamp: current.openTime,
								side: 'BUY',
								price: entryPrice,
								confidence: 1.0,
								stopLoss: stopLossPrice,
								takeProfit: takeProfitPrice,
								reason: `GEMINI 1 BUY: Liquidity Sweep under $${lowestLow20.toFixed(4)}, Bullish Pinbar (Lower Wick: ${lowerWick.toFixed(4)} vs Body: ${body.toFixed(4)}) & Volume Climax (Vol: ${current.volume.toFixed(0)} vs SMA: ${vSma.toFixed(0)})`,
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
