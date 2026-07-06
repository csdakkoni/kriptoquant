import type { Candle } from '../../core/types.js';

export interface FeatureSeries {
	readonly timestamp: number[];
	readonly values: Record<string, number[]>;
}

export interface Feature {
	readonly name: string;
	calculate(candles: Candle[]): FeatureSeries;
}
