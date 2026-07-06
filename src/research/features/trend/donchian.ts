import type { Candle } from '../../../core/types.js';
import type { Feature, FeatureSeries } from '../types.js';

export class DonchianBreakout implements Feature {
	public readonly name: string;
	private readonly period: number;

	constructor(period: number = 20) {
		this.period = period;
		this.name = `donchian_breakout_${period}`;
	}

	public calculate(candles: Candle[]): FeatureSeries {
		const n = candles.length;
		const timestamp = candles.map(c => c.openTime);

		const donchianHigh = new Array<number>(n).fill(NaN);
		const donchianLow = new Array<number>(n).fill(NaN);
		const breakoutAbove = new Array<number>(n).fill(0);
		const breakoutBelow = new Array<number>(n).fill(0);
		const distanceFromUpperBand = new Array<number>(n).fill(NaN);
		const distanceFromLowerBand = new Array<number>(n).fill(NaN);
		const barsSinceBreakout = new Array<number>(n).fill(NaN);

		let lastBreakoutIndex = -1;

		for (let i = 0; i < n; i++) {
			if (i < this.period) {
				continue;
			}

			// Calculate High/Low of previous N periods (excluding current index i)
			let maxHigh = -Infinity;
			let minLow = Infinity;
			for (let j = i - this.period; j < i; j++) {
				if (candles[j].high > maxHigh) {
					maxHigh = candles[j].high;
				}
				if (candles[j].low < minLow) {
					minLow = candles[j].low;
				}
			}

			donchianHigh[i] = maxHigh;
			donchianLow[i] = minLow;

			const close = candles[i].close;

			// Breakout detection
			if (close > maxHigh) {
				breakoutAbove[i] = 1;
				lastBreakoutIndex = i;
			}
			if (close < minLow) {
				breakoutBelow[i] = 1;
				lastBreakoutIndex = i;
			}

			// Distance calculations
			distanceFromUpperBand[i] = (maxHigh - close) / close;
			distanceFromLowerBand[i] = (close - minLow) / close;

			// Bars since breakout
			if (lastBreakoutIndex !== -1) {
				barsSinceBreakout[i] = i - lastBreakoutIndex;
			}
		}

		return {
			timestamp,
			values: {
				donchianHigh,
				donchianLow,
				breakoutAbove,
				breakoutBelow,
				distanceFromUpperBand,
				distanceFromLowerBand,
				barsSinceBreakout
			}
		};
	}
}
