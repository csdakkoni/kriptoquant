// ============================================================================
// KRIPTOQUANT — Momentum Burst (Hızlı İşlem / Deney Slotu)
// ============================================================================
// Fast Lab (src/research/experiments/fast_lab.ts) bulgusu: momentum patlaması
// ailesi, 2025-26 ayı yılında bile başabaş civarı tek hızlı strateji ailesiydi
// (sıkı varyant rejim filtreli PF 1.047; bu gevşek varyant filtresiz -%3.2/yıl).
// STATÜ: Deney slotu — kâr faktörü kanıtlanana kadar gerçek para adayı DEĞİL.
//
// Kurallar (15m):
// 1. Giriş: Tek mumda >= +%1.2 artış + hacim > 2x SMA20(hacim) + kapanış > EMA9.
// 2. Çıkış: Kapanış EMA9 altına inince (momentum bitti) veya 16 mum (4 saat).
// 3. SL: Giriş - 2*ATR (metadata ile motora iletilir).
// Canlı motorda BTC rejim filtresinden MUAFTIR (ayı rallisi habitatıdır).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { atr, sma, ema } from '../../../core/indicators/index.js';

export function createMomentumBurstStrategy(
	minRetPct: number = 1.2,
	volMult: number = 2,
	slAtrMult: number = 2,
	maxBars: number = 16,
): Strategy {
	return {
		name: 'momentum-burst',
		description: `Momentum Burst (ret>=${minRetPct}%, vol>${volMult}x, EMA9 trail, max ${maxBars} bar)`,
		warmupPeriod: 30,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 30) return [];

			const closes = candles.map((c) => c.close);
			const volumes = candles.map((c) => c.volume);
			const ema9 = ema(closes, 9);
			const volSma = sma(volumes, 20);
			const atrValues = atr(candles, 14);

			// Pozisyon durumu mum geçmişinden deterministik türetilir; canlı motor
			// her kapanan mumda tüm pencereyi yeniden değerlendirdiği için tutarlıdır.
			let inPos = false;
			let entryPrice = 0;
			let entryAtr = 0;
			let barsHeld = 0;

			for (let i = 30; i < candles.length; i++) {
				const c = candles[i];
				const prev = candles[i - 1];
				const atrVal = atrValues[i];
				if (Number.isNaN(ema9[i]) || Number.isNaN(volSma[i]) || Number.isNaN(atrVal)) continue;

				if (!inPos) {
					const retPct = ((c.close - prev.close) / prev.close) * 100;
					const volSpike = volSma[i] > 0 && c.volume > volMult * volSma[i];
					if (retPct >= minRetPct && volSpike && c.close > ema9[i]) {
						const sl = c.close - slAtrMult * atrVal;
						signals.push({
							timestamp: c.openTime,
							side: 'BUY',
							price: c.close,
							confidence: 0.7,
							reason: `Momentum Burst: +${retPct.toFixed(2)}% mum, hacim ${(c.volume / volSma[i]).toFixed(1)}x ortalama. SL = ${sl.toFixed(4)}`,
							metadata: { sl, atr: atrVal },
						});
						inPos = true;
						entryPrice = c.close;
						entryAtr = atrVal;
						barsHeld = 0;
					}
				} else {
					barsHeld++;
					// Motor SL'i tetiklemişse iç durumu sıfırla (SELL üretme, motor çıktı bile)
					if (c.low <= entryPrice - slAtrMult * entryAtr) {
						inPos = false;
						continue;
					}
					if (c.close < ema9[i] || barsHeld >= maxBars) {
						signals.push({
							timestamp: c.openTime,
							side: 'SELL',
							price: c.close,
							confidence: 0.7,
							reason: c.close < ema9[i]
								? `Momentum bitti: kapanış EMA9 altında (${c.close.toFixed(4)} < ${ema9[i].toFixed(4)})`
								: `Zaman stoplu çıkış: ${maxBars} mum doldu`,
						});
						inPos = false;
					}
				}
			}

			return signals;
		},
	} as any;
}
