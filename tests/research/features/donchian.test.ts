import { describe, it, expect } from 'vitest';
import { DonchianBreakout } from '../../../src/research/features/trend/donchian.js';
import type { Candle } from '../../../src/core/types.js';

describe('Donchian Breakout Feature Extractor', () => {
	it('should correctly calculate Donchian bands and detect breakouts', () => {
		const period = 5;
		const candles: Candle[] = [
			{ openTime: 1000, open: 6, high: 8, low: 4, close: 7, volume: 100, closeTime: 1999 },
			{ openTime: 2000, open: 7, high: 9, low: 5, close: 8, volume: 110, closeTime: 2999 },
			{ openTime: 3000, open: 8, high: 10, low: 6, close: 9, volume: 120, closeTime: 3999 },
			{ openTime: 4000, open: 9, high: 9.5, low: 7, close: 8.5, volume: 130, closeTime: 4999 },
			{ openTime: 5000, open: 8.5, high: 9, low: 5.5, close: 7.5, volume: 140, closeTime: 5999 },
			// At index 5: Previous 5 high max = 10. Previous 5 low min = 4.
			{ openTime: 6000, open: 7.5, high: 11, low: 6, close: 10.5, volume: 150, closeTime: 6999 }, // Breakout Above (10.5 > 10)
			{ openTime: 7000, open: 10.5, high: 10.8, low: 9.5, close: 10.1, volume: 160, closeTime: 7999 }, // No breakout
			{ openTime: 8000, open: 10.1, high: 10.2, low: 3.5, close: 3.0, volume: 170, closeTime: 8999 }, // Breakout Below (3.0 < 4.0)
		];

		const extractor = new DonchianBreakout(period);
		const result = extractor.calculate(candles);

		// Period indices should be NaN
		expect(result.values.donchianHigh[0]).toBeNaN();
		expect(result.values.donchianHigh[4]).toBeNaN();

		// Index 5 assertions
		expect(result.values.donchianHigh[5]).toBe(10); // Max of [8, 9, 10, 9.5, 9]
		expect(result.values.donchianLow[5]).toBe(4);   // Min of [4, 5, 6, 7, 5.5]
		expect(result.values.breakoutAbove[5]).toBe(1); // 10.5 > 10
		expect(result.values.breakoutBelow[5]).toBe(0);
		expect(result.values.barsSinceBreakout[5]).toBe(0);

		// Index 6 assertions
		expect(result.values.breakoutAbove[6]).toBe(0); // 10.1 <= 11 (Max of index 1 to 5: 9, 10, 9.5, 9, 11 -> Max is 11)
		expect(result.values.barsSinceBreakout[6]).toBe(1); // 1 bar since breakout at index 5

		// Index 7 assertions
		expect(result.values.donchianLow[7]).toBe(5.5); // Min of index 2 to 6: [6, 7, 5.5, 6, 9.5] -> Min is 5.5
		expect(result.values.breakoutBelow[7]).toBe(1); // 3.0 < 5.5
		expect(result.values.barsSinceBreakout[7]).toBe(0); // Reset on breakout
	});
});
