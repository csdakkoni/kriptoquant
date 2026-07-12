import { describe, expect, it } from 'vitest';
import { bollingerBands } from '../../../src/core/indicators/bollinger.js';

describe('bollingerBands', () => {
	it('should calculate upper, middle, and lower bands correctly', () => {
		const closes = [10, 12, 14, 16, 18];
		const period = 3;
		const multiplier = 2;

		const result = bollingerBands(closes, period, multiplier);

		expect(result.middle[0]).toBeNaN();
		expect(result.middle[1]).toBeNaN();

		// index 2 (values: 10, 12, 14):
		// mean = (10+12+14)/3 = 12
		// population variance = ((10-12)^2 + (12-12)^2 + (14-12)^2) / 3 = (4 + 0 + 4) / 3 = 2.6667
		// population stdDev = sqrt(2.6667) ≈ 1.6330
		// middle = 12, upper = 12 + 2*1.6330 ≈ 15.266, lower = 12 - 2*1.6330 ≈ 8.734
		expect(result.middle[2]).toBeCloseTo(12, 4);
		expect(result.upper[2]).toBeCloseTo(15.266, 2);
		expect(result.lower[2]).toBeCloseTo(8.734, 2);
	});
});
