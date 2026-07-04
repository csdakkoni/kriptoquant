// ============================================================================
// KRIPTOQUANT — Timeline Provider (Sprint 18)
// ============================================================================
// Çoklu varlıkların mum serilerini tek bir kronolojik zaman çizelgesine dizer.
// ============================================================================

import type { Candle } from '../../core/types.js';
import type { AlignedTimelineStep } from './types.js';

export interface TimelineProvider {
	alignCandles(candlesMap: Map<string, Candle[]>): AlignedTimelineStep[];
}

export class CSVTimelineProvider implements TimelineProvider {
	/**
	 * Farklı coinlerin mum dizilerini openTime bazında kronolojik hizalar.
	 *
	 * @param candlesMap - Coin -> Mum serisi haritası
	 */
	alignCandles(candlesMap: Map<string, Candle[]>): AlignedTimelineStep[] {
		const allTimestampsSet = new Set<number>();

		for (const list of candlesMap.values()) {
			for (const c of list) {
				allTimestampsSet.add(c.openTime);
			}
		}

		const sortedTimestamps = Array.from(allTimestampsSet).sort((a, b) => a - b);

		// O(1) arama yapabilmek için coin bazlı [timestamp -> candle] haritası kur
		const coinTimeMap = new Map<string, Map<number, Candle>>();
		for (const [coin, list] of candlesMap.entries()) {
			const timeMap = new Map<number, Candle>();
			for (const c of list) {
				timeMap.set(c.openTime, c);
			}
			coinTimeMap.set(coin, timeMap);
		}

		// Hizalı zaman akışını oluştur
		const timeline: AlignedTimelineStep[] = [];
		for (const ts of sortedTimestamps) {
			const stepCandles = new Map<string, Candle>();
			for (const [coin, timeMap] of coinTimeMap.entries()) {
				const candle = timeMap.get(ts);
				if (candle) {
					stepCandles.set(coin, candle);
				}
			}
			timeline.push({
				timestamp: ts,
				candles: stepCandles,
			});
		}

		return timeline;
	}
}
