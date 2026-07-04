// ============================================================================
// KRIPTOQUANT — Donchian Breakout Strategy
// ============================================================================
// Richard Donchian'ın kanal kırılım stratejisi. Turtle Trading'in temelidir.
// BUY:  Close önceki N mumun en yüksek High'ını aşarsa (yukarı kırılım)
// SELL: Close önceki N mumun en düşük Low'unun altına düşerse (aşağı kırılım)
// Filtreler → Filter Engine'de. Güven skoru → Confidence Engine'de.
// Strateji sadece piyasa sinyali üretir — tek sorumluluk.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { donchianChannel } from '../../../core/indicators/index.js';

/**
 * Donchian Breakout stratejisi.
 *
 * @param period - Kanal periyodu (varsayılan: 20)
 */
export function createDonchianBreakoutStrategy(period: number = 20): Strategy {
	return {
		name: 'donchian-breakout',
		description: `Donchian Breakout (${period})`,
		warmupPeriod: period + 1,
		version: '1.0.0',
		tags: ['breakout', 'trend-following'],
		supportedRegimes: ['BULL_HIGH', 'BULL_LOW', 'BEAR_HIGH', 'BEAR_LOW'],
		defaultParameters: { period },

		evaluate(candles: Candle[]): Signal[] {
			const { upper, lower } = donchianChannel(candles, period);
			const signals: Signal[] = [];

			// Durum takibi: yalnızca kırılım anında sinyal üret, devamlılıkta değil
			let wasAboveUpper = false;
			let wasBelowLower = false;

			for (let i = period; i < candles.length; i++) {
				if (Number.isNaN(upper[i]) || Number.isNaN(lower[i])) continue;

				const isAboveUpper = candles[i].close > upper[i];
				const isBelowLower = candles[i].close < lower[i];

				// BUY: Yukarı kırılım (ilk kez kanalın üstüne çıkış)
				if (isAboveUpper && !wasAboveUpper) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'BUY',
						price: candles[i].close,
						confidence: 1.0,
						reason: `Close (${candles[i].close.toFixed(2)}) broke above Upper Channel (${upper[i].toFixed(2)})`,
						metadata: { indicatorFast: upper[i], indicatorSlow: lower[i] },
					});
				}

				// SELL: Aşağı kırılım (ilk kez kanalın altına düşüş)
				if (isBelowLower && !wasBelowLower) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'SELL',
						price: candles[i].close,
						confidence: 1.0,
						reason: `Close (${candles[i].close.toFixed(2)}) broke below Lower Channel (${lower[i].toFixed(2)})`,
						metadata: { indicatorFast: upper[i], indicatorSlow: lower[i] },
					});
				}

				wasAboveUpper = isAboveUpper;
				wasBelowLower = isBelowLower;
			}

			return signals;
		},
	};
}
