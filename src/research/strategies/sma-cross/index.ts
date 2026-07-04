// ============================================================================
// KRIPTOQUANT — SMA Crossover Strategy
// ============================================================================
// Kısa SMA uzun SMA'yı yukarı keserse AL, aşağı keserse SAT.
// Confidence: İki SMA arasındaki farkın ATR'ye oranı.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { sma } from '../../../core/indicators/index.js';

/**
 * SMA Crossover stratejisi.
 *
 * @param fastPeriod - Hızlı SMA periyodu (varsayılan: 10)
 * @param slowPeriod - Yavaş SMA periyodu (varsayılan: 30)
 */
export function createSmaCrossStrategy(fastPeriod: number = 10, slowPeriod: number = 30): Strategy {
	return {
		name: 'sma-cross',
		description: `SMA Crossover (${fastPeriod}/${slowPeriod})`,
		warmupPeriod: slowPeriod + 1,
		version: '1.0.0',
		tags: ['trend-following', 'crossover'],
		supportedRegimes: ['BULL_HIGH', 'BULL_LOW', 'BEAR_HIGH', 'BEAR_LOW'],
		defaultParameters: { fastPeriod, slowPeriod },

		evaluate(candles: Candle[]): Signal[] {
			const closes = candles.map((c) => c.close);
			const fastSma = sma(closes, fastPeriod);
			const slowSma = sma(closes, slowPeriod);

			const signals: Signal[] = [];

			for (let i = slowPeriod; i < candles.length; i++) {
				const prevFast = fastSma[i - 1];
				const prevSlow = slowSma[i - 1];
				const currFast = fastSma[i];
				const currSlow = slowSma[i];

				if (Number.isNaN(prevFast) || Number.isNaN(prevSlow) || Number.isNaN(currFast) || Number.isNaN(currSlow)) {
					continue;
				}

				if (prevFast <= prevSlow && currFast > currSlow) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'BUY',
						price: candles[i].close,
						confidence: 1.0,
						reason: `SMA${fastPeriod} (${currFast.toFixed(2)}) crossed above SMA${slowPeriod} (${currSlow.toFixed(2)})`,
						metadata: { indicatorFast: currFast, indicatorSlow: currSlow },
					});
				}

				if (prevFast >= prevSlow && currFast < currSlow) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'SELL',
						price: candles[i].close,
						confidence: 1.0,
						reason: `SMA${fastPeriod} (${currFast.toFixed(2)}) crossed below SMA${slowPeriod} (${currSlow.toFixed(2)})`,
						metadata: { indicatorFast: currFast, indicatorSlow: currSlow },
					});
				}
			}

			return signals;
		},
	};
}
