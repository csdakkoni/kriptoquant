// ============================================================================
// KRIPTOQUANT — EMA Crossover Strategy
// ============================================================================
// Hızlı EMA yavaş EMA'yı keserse sinyal üretir. Başka hiçbir şey yapmaz.
// Filtreler → Filter Engine'de. Güven skoru → Confidence Engine'de.
// Strateji sadece piyasa sinyali üretir — tek sorumluluk.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { ema } from '../../../core/indicators/index.js';

/**
 * EMA Crossover stratejisi.
 *
 * @param fastPeriod - Hızlı EMA periyodu (varsayılan: 9)
 * @param slowPeriod - Yavaş EMA periyodu (varsayılan: 21)
 */
export function createEmaCrossStrategy(fastPeriod: number = 9, slowPeriod: number = 21): Strategy {
	return {
		name: 'ema-cross',
		description: `EMA Crossover (${fastPeriod}/${slowPeriod})`,
		warmupPeriod: slowPeriod + 1,
		version: '1.0.0',
		tags: ['trend-following', 'crossover'],
		supportedRegimes: ['BULL_HIGH', 'BULL_LOW', 'BEAR_HIGH', 'BEAR_LOW'],
		defaultParameters: { fastPeriod, slowPeriod },

		evaluate(candles: Candle[]): Signal[] {
			const closes = candles.map((c) => c.close);
			const fastEma = ema(closes, fastPeriod);
			const slowEma = ema(closes, slowPeriod);

			const signals: Signal[] = [];

			for (let i = slowPeriod; i < candles.length; i++) {
				const prevFast = fastEma[i - 1];
				const prevSlow = slowEma[i - 1];
				const currFast = fastEma[i];
				const currSlow = slowEma[i];

				if (Number.isNaN(prevFast) || Number.isNaN(prevSlow) || Number.isNaN(currFast) || Number.isNaN(currSlow)) {
					continue;
				}

				if (prevFast <= prevSlow && currFast > currSlow) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'BUY',
						price: candles[i].close,
						confidence: 1.0,
						reason: `EMA${fastPeriod} (${currFast.toFixed(2)}) crossed above EMA${slowPeriod} (${currSlow.toFixed(2)})`,
						metadata: { indicatorFast: currFast, indicatorSlow: currSlow },
					});
				}

				if (prevFast >= prevSlow && currFast < currSlow) {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'SELL',
						price: candles[i].close,
						confidence: 1.0,
						reason: `EMA${fastPeriod} (${currFast.toFixed(2)}) crossed below EMA${slowPeriod} (${currSlow.toFixed(2)})`,
						metadata: { indicatorFast: currFast, indicatorSlow: currSlow },
					});
				}
			}

			return signals;
		},
	};
}
