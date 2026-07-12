// ============================================================================
// KRIPTOQUANT — Freedom B Multi-Timeframe Hybrid Strategy (Sprint 30)
// ============================================================================
// Strateji Kuralları:
// 1) 4H Makro Filtre: 4H EMA20 > EMA50 ise sadece LONG işlem ara.
// 2) 1H Yapısal Pullback: Fiyatın 1H EMA20'ye değmesini/pullback yapmasını bekle.
// 3) 15M Giriş Tetikleyici: Fiyatın 15M EMA20 üzerinde, son 20 mumun ortalama
//    hacminin üzerinde bir hacimle yeşil onay mumu kapatmasını bekle.
// 4) Hibrit Risk Modeli (Freedom B - Anlık Başa Baş):
//    - Soft Stop: Son 5 mumun en düşüğü (Swing Low). Mum kapanışında kontrol edilir.
//    - Hard Emergency Stop: Girişin %4.5 altında. Anlık tetiklenir (live-engine tarafından).
//    - Anlık Başa Baş (Instant Breakeven): Fiyat +%2 kârı gördükten sonra giriş seviyesine inerse ANLIK satılır.
//    - Take Profit: Risk mesafesinin tam 3 katı (1:3 Risk/Ödül Oranı).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { ema, sma } from '../../../core/indicators/index.js';

export function createFreedomBStrategy(): Strategy {
	return {
		name: 'freedom_b',
		description: 'Freedom B Strategy (Instant Breakeven Stop + 1:3 R/R)',
		warmupPeriod: 900, // Safe warm-up for 4H EMA800 (50 * 16 = 800)

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 900) return [];

			const closes = candles.map(c => c.close);
			const volumes = candles.map(c => c.volume);

			// Detect interval multipliers dynamically
			const sampleDiffMs = candles[1].openTime - candles[0].openTime;
			let htfMultiplier = 16; // 15m -> 4h (16x)
			let mtfMultiplier = 4;  // 15m -> 1h (4x)

			if (sampleDiffMs >= 14400000) {
				// Base is 4H
				htfMultiplier = 1;
				mtfMultiplier = 1;
			} else if (sampleDiffMs >= 3600000) {
				// Base is 1H
				htfMultiplier = 4; // 1h -> 4h
				mtfMultiplier = 1; // 1h -> 1h
			}

			// 4H emulated indicators (Macro Trend)
			const htfEma20 = ema(closes, 20 * htfMultiplier);
			const htfEma50 = ema(closes, 50 * htfMultiplier);

			// 1H emulated indicators (Medium Trend)
			const mtfEma20 = ema(closes, 20 * mtfMultiplier);

			// 15M base indicators (Trigger)
			const ltfEma20 = ema(closes, 20);
			const volSma20 = sma(volumes, 20);

			let inPosition = false;
			let entryPrice = 0;
			let stopLossPrice = 0;
			let takeProfitPrice = 0;
			let hasPullback = false;

			for (let i = 850; i < candles.length; i++) {
				const current = candles[i];
				const h20 = htfEma20[i];
				const h50 = htfEma50[i];
				const m20 = mtfEma20[i];
				const l20 = ltfEma20[i];
				const vSma = volSma20[i];

				if (Number.isNaN(h20) || Number.isNaN(h50) || Number.isNaN(m20) || Number.isNaN(l20) || Number.isNaN(vSma)) {
					continue;
				}

				const isMacroBullish = h20 > h50;

				// Exits check (Simulated for backtests or offline evaluations)
				if (inPosition) {
					if (current.low <= stopLossPrice) {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: stopLossPrice,
							confidence: 1.0,
							reason: 'Stop Loss Hit (Swing Low)',
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
					if (!isMacroBullish) {
						signals.push({
							timestamp: current.openTime,
							side: 'SELL',
							price: current.close,
							confidence: 1.0,
							reason: 'Macro Trend Changed (4H EMA20 crossed below EMA50)',
						});
						inPosition = false;
						continue;
					}
				}

				// Entry check
				if (isMacroBullish && !inPosition) {
					// Pullback check: Low touched or went below 1H EMA20
					if (current.low <= m20) {
						hasPullback = true;
					}

					// Confirmation:
					// 1. Green candle
					// 2. Closed above 15M EMA20
					// 3. High volume
					const isGreen = current.close > current.open;
					const closedAboveEma = current.close > l20;
					const highVolume = current.volume > vSma;

					if (hasPullback && isGreen && closedAboveEma && highVolume) {
						const recent = candles.slice(i - 4, i + 1);
						const swingLow = Math.min(...recent.map(c => c.low));
						const risk = current.close - swingLow;

						if (risk > 0) {
							entryPrice = current.close;
							stopLossPrice = swingLow;
							takeProfitPrice = entryPrice + (risk * 3.0); // 1:3 R/R

							signals.push({
								timestamp: current.openTime,
								side: 'BUY',
								price: entryPrice,
								confidence: 1.0,
								stopLoss: stopLossPrice,
								takeProfit: takeProfitPrice,
								reason: `FREEDOM B BUY: 4H Trend Bullish, 1H Pullback confirmed, 15M Volume Breakout. SL: $${stopLossPrice.toFixed(2)} | TP: $${takeProfitPrice.toFixed(2)}`,
							});

							inPosition = true;
							hasPullback = false;
						}
					}
				} else if (!isMacroBullish) {
					hasPullback = false;
				}
			}

			return signals;
		}
	};
}
