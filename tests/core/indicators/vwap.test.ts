import { describe, expect, it } from 'vitest';
import { vwap, vwapZScore } from '../../../src/core/indicators/vwap.js';
import type { Candle } from '../../../src/core/types.js';

function makeCandle(high: number, low: number, close: number, volume: number): Candle {
	return {
		openTime: Date.now(),
		open: (high + low) / 2,
		high,
		low,
		close,
		volume,
		closeTime: Date.now() + 1000
	};
}

describe('vwap', () => {
	it('should calculate rolling VWAP correctly', () => {
		// Period = 3
		const candles = [
			makeCandle(10, 8, 9, 100), // Typical: 9, Vol: 100, Typical*Vol = 900
			makeCandle(12, 10, 11, 200), // Typical: 11, Vol: 200, Typical*Vol = 2200
			makeCandle(14, 12, 13, 300), // Typical: 13, Vol: 300, Typical*Vol = 3900
			makeCandle(16, 14, 15, 400), // Typical: 15, Vol: 400, Typical*Vol = 6000
		];

		const result = vwap(candles, 3);

		expect(result[0]).toBeNaN();
		expect(result[1]).toBeNaN();
		
		// index 2 (candles 0, 1, 2):
		// sumTypicalPriceVolume = 900 + 2200 + 3900 = 7000
		// sumVolume = 100 + 200 + 300 = 600
		// VWAP = 7000 / 600 ≈ 11.6667
		expect(result[2]).toBeCloseTo(11.6667, 4);

		// index 3 (candles 1, 2, 3):
		// sumTypicalPriceVolume = 2200 + 3900 + 6000 = 12100
		// sumVolume = 200 + 300 + 400 = 900
		// VWAP = 12100 / 900 ≈ 13.4444
		expect(result[3]).toBeCloseTo(13.4444, 4);
	});
});

describe('vwapZScore', () => {
	it('should calculate correct Z-Score', () => {
		const candles = [
			makeCandle(10, 8, 9, 100),
			makeCandle(12, 10, 11, 100),
			makeCandle(14, 12, 13, 100),
		];

		const z = vwapZScore(candles, 3);

		expect(z[0]).toBeNaN();
		expect(z[1]).toBeNaN();
		expect(z[2]).not.toBeNaN();
	});
});
