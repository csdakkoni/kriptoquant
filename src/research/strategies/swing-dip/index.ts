// ============================================================================
// KRIPTOQUANT — Swing Dip (Kullanıcı Stratejisi)
// ============================================================================
// Erdem'in kuralı: "Tepeden %10 düşeni al, +%10 yükselince sat, -%10'da kes."
// swing_dip_lab.ts doğrulaması: test edilen 60+ long konfigürasyonun en iyisi
// (ayı yılında PF 0.871, -%1.5). Yatay/boğa piyasada pozitife geçmeye en yakın
// aday. BTC rejim filtresinden MUAFTIR — derin dipler doğası gereği RISK_OFF'ta
// oluşur; filtre stratejinin habitatını yok eder (lab bulgusu: filtreli PF 0.12).
//
// Kurallar (1h):
// 1. Giriş: Kapanış, son 48 saatin tepesinden %10 aşağıya indiği an.
// 2. TP: Giriş +%10 (metadata.tp) | SL: Giriş -%10 (metadata.sl).
// 3. Zaman stopu: 168 saat (7 gün) — SELL sinyaliyle.
// 4. Re-arm: Çıkıştan sonra fiyat dip çizgisinin üstüne dönmeden yeni giriş yok
//    (uzun düşüşte merdivenleme yapmaz).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';

export function createSwingDipStrategy(
	dipPct: number = 10,
	tpPct: number = 10,
	slPct: number = 10,
	lookbackBars: number = 48,
	maxBars: number = 168,
): Strategy {
	return {
		name: 'swing-dip',
		description: `Swing Dip (tepe -%${dipPct} al, +%${tpPct} sat, -%${slPct} kes, maks ${maxBars} bar)`,
		warmupPeriod: lookbackBars + 2,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < lookbackBars + 2) return [];

			let inPos = false;
			let armed = true;
			let entry = 0;
			let barsHeld = 0;

			for (let i = lookbackBars; i < candles.length; i++) {
				const c = candles[i];
				let rollHigh = 0;
				for (let j = i - lookbackBars; j < i; j++) {
					if (candles[j].high > rollHigh) rollHigh = candles[j].high;
				}
				const dipLine = rollHigh * (1 - dipPct / 100);

				if (!inPos) {
					if (!armed) {
						if (c.close > dipLine) armed = true;
						continue;
					}
					if (c.close <= dipLine) {
						entry = c.close;
						barsHeld = 0;
						inPos = true;
						signals.push({
							timestamp: c.openTime,
							side: 'BUY',
							price: c.close,
							confidence: 0.7,
							reason: `Swing Dip BUY: 48s tepesinden -%${dipPct} (${c.close.toFixed(4)} <= ${dipLine.toFixed(4)}). TP +%${tpPct}, SL -%${slPct}.`,
							metadata: {
								sl: entry * (1 - slPct / 100),
								tp: entry * (1 + tpPct / 100),
							},
						});
					}
				} else {
					barsHeld++;
					// Motor SL/TP'yi tik bazında yönetir; iç durum senkronu:
					if (c.low <= entry * (1 - slPct / 100) || c.high >= entry * (1 + tpPct / 100)) {
						inPos = false;
						armed = false;
						continue;
					}
					if (barsHeld >= maxBars) {
						signals.push({
							timestamp: c.openTime,
							side: 'SELL',
							price: c.close,
							confidence: 0.7,
							reason: `Swing Dip Zaman Stopu: ${maxBars} bar (${(maxBars / 24).toFixed(0)} gün) doldu, hedefe ulaşılamadı.`,
						});
						inPos = false;
						armed = false;
					}
				}
			}

			return signals;
		},
	} as any;
}
