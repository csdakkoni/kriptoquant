// ============================================================================
// KRIPTOQUANT — Donchian Short (Ayı Kanadı)
// ============================================================================
// two_wing_lab.ts doğrulaması: 365 günlük ayı verisinde PF 1.288, +%2.73,
// maxDD %5.7 — test edilen tüm konfigürasyonlar arasında İLK pozitif sonuç.
// Sistemin "düşüşte de kazanan" kanadı.
//
// Kurallar (4h):
// 1. Giriş (SHORT AÇ → BUY sinyali*): Kapanış Donchian(20) alt bandının altına
//    inince kırılım yönünde short.
// 2. Çıkış (COVER → SELL sinyali*): Kapanış üst bandın üstüne çıkınca.
// 3. SL: Giriş +%6 (metadata.sl — short'ta stop girişin üstündedir).
// (*) Canlı motor SHORT_STRATEGIES setindeki stratejilerde sinyal semantiğini
//     ters çevirir: BUY = short aç, SELL = short kapat.
// NOT: Paper modda futures simülasyonu; gerçek para modunda motor short'u
//      reddeder (Binance TR spot). Funding maliyeti modellenmemiştir.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { donchianChannel } from '../../../core/indicators/index.js';

export function createDonchianShortStrategy(
	period: number = 20,
	hardStopPct: number = 6,
): Strategy {
	return {
		name: 'donchian-short',
		description: `Donchian Short (${period}) — alt kırılımda short, üst kırılımda cover, SL +%${hardStopPct}`,
		warmupPeriod: period + 2,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < period + 2) return [];

			const { upper, lower } = donchianChannel(candles, period);
			let inPos = false;
			let entry = 0;

			for (let i = period + 1; i < candles.length; i++) {
				const c = candles[i];
				if (Number.isNaN(upper[i]) || Number.isNaN(lower[i])) continue;

				if (!inPos) {
					if (c.close < lower[i]) {
						entry = c.close;
						inPos = true;
						signals.push({
							timestamp: c.openTime,
							side: 'BUY', // = SHORT AÇ (motor ters çevirir)
							price: c.close,
							confidence: 0.75,
							reason: `Donchian SHORT: Kapanış alt bandı kırdı (${c.close.toFixed(4)} < ${lower[i].toFixed(4)}). SL +%${hardStopPct}.`,
							metadata: {
								sl: entry * (1 + hardStopPct / 100),
								tp: 0, // hedef yok — üst bant kırılımına kadar sür
							},
						});
					}
				} else {
					// Motor SL'i tik bazında yönetir; iç durum senkronu:
					if (c.high >= entry * (1 + hardStopPct / 100)) {
						inPos = false;
						continue;
					}
					if (c.close > upper[i]) {
						signals.push({
							timestamp: c.openTime,
							side: 'SELL', // = COVER (motor ters çevirir)
							price: c.close,
							confidence: 0.75,
							reason: `Donchian COVER: Kapanış üst bandı kırdı (${c.close.toFixed(4)} > ${upper[i].toFixed(4)}).`,
						});
						inPos = false;
					}
				}
			}

			return signals;
		},
	} as any;
}
