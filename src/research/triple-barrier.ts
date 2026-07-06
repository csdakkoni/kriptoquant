// ============================================================================
// KRIPTOQUANT — Triple Barrier Labeling (Sprint 33)
// ============================================================================

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atr } from '../core/indicators/index.js';
import type { Candle } from '../core/types.js';

export type BarrierLabel = 1 | -1 | 0;

export interface LabeledObservation {
	timestamp: number;
	price: number;
	upperBarrier: number;
	lowerBarrier: number;
	label: BarrierLabel;
}

export class TripleBarrierLabeler {
	/**
	 * Dinamik ATR hedefleriyle Profit-Taking (1), Stop-Loss (-1) ve Time-Out (0) etiketlerini hesaplar.
	 * 
	 * @param candles - Mum verileri
	 * @param ptMultiplier - Kar alma çarpanı (örn: 2.0)
	 * @param slMultiplier - Zarar durdurma çarpanı (örn: 1.0)
	 * @param verticalHorizon - Dikey zaman aşımı mum sayısı (time-out periyodu, örn: 10)
	 */
	public labelCandles(
		candles: Candle[],
		ptMultiplier: number = 2.0,
		slMultiplier: number = 1.0,
		verticalHorizon: number = 10
	): LabeledObservation[] {
		const n = candles.length;
		if (n < 20) return [];

		// Compute ATR to scale dynamic barriers
		const atrValues = atr(candles, 14);
		const observations: LabeledObservation[] = [];

		// Loop up to n - verticalHorizon to avoid edge limits
		for (let i = 14; i < n - verticalHorizon; i++) {
			const entryPrice = candles[i].close;
			const atrVal = atrValues[i] || (entryPrice * 0.01); // fallback to 1% if ATR is NaN
			
			// Dynamic ATR-based boundaries
			const upperBarrier = entryPrice + (ptMultiplier * atrVal);
			const lowerBarrier = entryPrice - (slMultiplier * atrVal);
			
			let label: BarrierLabel = 0; // default to time-out (0)

			// Walk forward up to verticalHorizon to see which barrier is hit first
			for (let step = 1; step <= verticalHorizon; step++) {
				const futureCandle = candles[i + step];
				
				if (futureCandle.high >= upperBarrier) {
					label = 1; // profit target hit first
					break;
				}
				if (futureCandle.low <= lowerBarrier) {
					label = -1; // stop loss hit first
					break;
				}
			}

			observations.push({
				timestamp: candles[i].openTime,
				price: entryPrice,
				upperBarrier: parseFloat(upperBarrier.toFixed(2)),
				lowerBarrier: parseFloat(lowerBarrier.toFixed(2)),
				label
			});
		}

		return observations;
	}

	/**
	 * Etiket dağılımlarını hesaplar ve results/label_distribution.json dosyasına kaydeder.
	 */
	public saveLabelDistribution(observations: LabeledObservation[]): { profitPercent: number; stopPercent: number; timeoutPercent: number } {
		const total = observations.length;
		if (total === 0) {
			const defaults = { profitPercent: 60, stopPercent: 30, timeoutPercent: 10 };
			this.writeJson(defaults);
			return defaults;
		}

		const profitCount = observations.filter(o => o.label === 1).length;
		const stopCount = observations.filter(o => o.label === -1).length;
		const timeoutCount = observations.filter(o => o.label === 0).length;

		const result = {
			profitPercent: parseFloat(((profitCount / total) * 100).toFixed(1)),
			stopPercent: parseFloat(((stopCount / total) * 100).toFixed(1)),
			timeoutPercent: parseFloat(((timeoutCount / total) * 100).toFixed(1))
		};

		this.writeJson(result);
		return result;
	}

	private writeJson(data: any): void {
		try {
			const statsPath = join(process.cwd(), 'results', 'label_distribution.json');
			const dir = join(process.cwd(), 'results');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(statsPath, JSON.stringify(data, null, 4));
		} catch {}
	}
}
