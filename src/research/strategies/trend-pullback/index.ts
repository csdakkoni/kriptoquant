// ============================================================================
// KRIPTOQUANT — Multi-Timeframe Trend Pullback Strategy (Sprint 30)
// ============================================================================
// Strateji Kuralları:
// 1) 1H Trend Filtresi: 1H grafikte EMA20 > EMA50 ise sadece long işlemler ara.
// 2) Geri Çekilme (Pullback): Düşük zaman diliminde (LTF - ör. 5M) fiyat EMA20'ye değsin.
// 3) Onay ve Giriş: Geri çekilmeden sonra, EMA20 üzerinde kapanan yeşil ve hacimli
//    bir onay mumu oluştuğunda Long pozisyona girilir.
// 4) Stop Loss: Son swing dip seviyesi.
// 5) Take Profit: 1:2 Risk/Ödül oranı.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { ema, sma } from '../../../core/indicators/index.js';

export function createTrendPullbackStrategy(): Strategy {
	return {
		name: 'trend-pullback',
		description: 'Trend Pullback (1H + 5M)',
		warmupPeriod: 650, // Emüle edilen 1H EMA50 için warmup
		tags: ['trend-following', 'pullback', 'multitimeframe'],

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 650) return [];

			const closes = candles.map((c) => c.close);
			const volume = candles.map((c) => c.volume);

			// Zaman dilimi çarpanını dinamik tespit et
			const sampleDiffMs = candles[1].openTime - candles[0].openTime;
			let multiplier = 12; // 5m -> 1h (12x)
			if (sampleDiffMs >= 3600000) {
				multiplier = 1; // 1h -> 1h
			} else if (sampleDiffMs >= 900000) {
				multiplier = 4; // 15m -> 1h
			}

			// Emüle edilen HTF (1H) trend EMA'ları
			const htfEma20 = ema(closes, 20 * multiplier);
			const htfEma50 = ema(closes, 50 * multiplier);

			// Mevcut zaman dilimi indikatörleri (5M)
			const ltfEma20 = ema(closes, 20);
			const volSma20 = sma(volume, 20);

			let inPosition = false;
			let entryPrice = 0;
			let stopLossPrice = 0;
			let takeProfitPrice = 0;
			let hasPullback = false;

			for (let i = 600; i < candles.length; i++) {
				const currentCandle = candles[i];
				const h20 = htfEma20[i];
				const h50 = htfEma50[i];
				const l20 = ltfEma20[i];
				const vSma = volSma20[i];

				if (Number.isNaN(h20) || Number.isNaN(h50) || Number.isNaN(l20) || Number.isNaN(vSma)) {
					continue;
				}

				// Pozisyondaysak çıkış kontrolleri
				if (inPosition) {
					if (currentCandle.low <= stopLossPrice) {
						signals.push({
							timestamp: currentCandle.openTime,
							side: 'SELL',
							price: stopLossPrice,
							confidence: 1.0,
							reason: `Stop Loss Hit (Swing Low)`,
						});
						inPosition = false;
						continue;
					}
					if (currentCandle.high >= takeProfitPrice) {
						signals.push({
							timestamp: currentCandle.openTime,
							side: 'SELL',
							price: takeProfitPrice,
							confidence: 1.0,
							reason: `Take Profit Hit (1:2 Risk/Reward)`,
						});
						inPosition = false;
						continue;
					}
					// Trend tersine dönerse çık (safeguard)
					if (h20 < h50) {
						signals.push({
							timestamp: currentCandle.openTime,
							side: 'SELL',
							price: currentCandle.close,
							confidence: 1.0,
							reason: `Trend Reversal (1H EMA20 crossed below EMA50)`,
						});
						inPosition = false;
						continue;
					}
				}

				// Giriş koşulları kontrolü (Sadece trend bullish iken)
				const isTrendBullish = h20 > h50;
				if (isTrendBullish && !inPosition) {
					// 5M mumunun en düşüğü EMA20 veya altına dokunduysa geri çekilme (pullback) okeydir
					if (currentCandle.low <= l20) {
						hasPullback = true;
					}

					// Onay mumu kontrolü:
					// 1. Yeşil mum (kapanış > açılış)
					// 2. Kapanış EMA20 üzerinde
					// 3. Hacim, son 20 mumun ortalama hacminin üzerinde (güçlü hacim)
					const isGreenCandle = currentCandle.close > currentCandle.open;
					const closedAboveEma20 = currentCandle.close > l20;
					const hasHighVolume = currentCandle.volume > vSma;

					if (hasPullback && isGreenCandle && closedAboveEma20 && hasHighVolume) {
						// Giriş fiyatı ve stop mesafesi belirleme
						const recentCandles = candles.slice(i - 5, i + 1);
						const swingLow = Math.min(...recentCandles.map((c) => c.low));
						const risk = currentCandle.close - swingLow;

						if (risk > 0) {
							entryPrice = currentCandle.close;
							stopLossPrice = swingLow;
							takeProfitPrice = entryPrice + risk * 2.0; // 1:2 R/R

							signals.push({
								timestamp: currentCandle.openTime,
								side: 'BUY',
								price: entryPrice,
								confidence: 1.0,
								reason: `1H Trend Bullish + Pullback gerçekleşti + Hacimli yeşil onay mumu. SL: $${stopLossPrice.toFixed(2)} | TP: $${takeProfitPrice.toFixed(2)}`,
							});
							inPosition = true;
							hasPullback = false;
						}
					}
				} else if (!isTrendBullish) {
					hasPullback = false;
				}
			}

			return signals;
		},
	};
}
