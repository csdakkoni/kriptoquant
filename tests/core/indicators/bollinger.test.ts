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
		// variance = ((10-12)^2 + (12-12)^2 + (14-12)^2) / (3-1) = (4 + 0 + 4) / 2 = 4
		// stdDev = sqrt(4) = 2
		// middle = 12, upper = 12 + 2*2 = 16, lower = 12 - 2*2 = 8
		expect(result.middle[2]).toBeCloseTo(12, 4);
		expect(result.upper[2]).toBeCloseTo(16, 4);
		expect(result.lower[2]).toBeCloseTo(8, 4);
	});
});
