// ============================================================================
// KRIPTOQUANT — Supertrend Strategy (Sprint 30)
// ============================================================================
// Welles Wilder'ın ATR bazlı trend takipçisi.
// BUY: Supertrend yönü yukarı döndüğünde (direction = 1)
// SELL: Supertrend yönü aşağı döndüğünde (direction = -1)
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { supertrend } from '../../../core/indicators/index.js';

/**
 * Supertrend Stratejisi.
 *
 * @param period - ATR periyodu (varsayılan: 10)
 * @param multiplier - ATR çarpanı (varsayılan: 3.0)
 */
export function createSupertrendStrategy(period: number = 10, multiplier: number = 3.0): Strategy {
	return {
		name: 'supertrend',
		description: `Supertrend (${period}/${multiplier.toFixed(1)})`,
		warmupPeriod: period + 2,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < period + 2) return [];

			const result = supertrend(candles, period, multiplier);
			const direction = result.direction;

			for (let i = period + 1; i < candles.length; i++) {
				const prevDir = direction[i - 1];
				const currDir = direction[i];

				if (Number.isNaN(prevDir) || Number.isNaN(currDir)) {
					continue;
				}

				// Yön yukarı dönerse (Bearish -> Bullish) -> BUY
				if (prevDir === -1 && currDir === 1) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'BUY',
						price: candles[i].close,
						confidence: 1.0,
						reason: `Supertrend turned Bullish (direction=1)`,
					});
				}

				// Yön aşağı dönerse (Bullish -> Bearish) -> SELL
				if (prevDir === 1 && currDir === -1) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'SELL',
						price: candles[i].close,
						confidence: 1.0,
						reason: `Supertrend turned Bearish (direction=-1)`,
					});
				}
			}

			return signals;
		},
	};
}
