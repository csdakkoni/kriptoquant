import { describe, it, expect, beforeEach } from 'vitest';
import { CorrelationMatrix } from '../../src/decision/correlation-matrix.js';

describe('CorrelationMatrix Unit Tests', () => {
	let matrix: CorrelationMatrix;

	beforeEach(() => {
		matrix = new CorrelationMatrix();
	});

	it('should compute Pearson correlation coefficient between X and Y within [-1, +1]', () => {
		const pricesX = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
		const pricesY = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];

		const corr = matrix.calculatePearsonCorrelation(pricesX, pricesY);
		expect(corr).toBeGreaterThan(0.95); // highly positive correlation
		expect(corr).toBeLessThanOrEqual(1.0);
	});

	it('should apply risk shaving correctly for highly correlated assets', () => {
		const allocations = [
			{ asset: 'BTC', percentage: 15 },
			{ asset: 'ETH', percentage: 12 },
			{ asset: 'SOL', percentage: 10 },
			{ asset: 'CASH', percentage: 63 }
		];

		const correlations = {
			'BTC': { 'ETH': 0.92, 'SOL': 0.70 },
			'ETH': { 'BTC': 0.92, 'SOL': 0.75 }
		};

		const shaved = matrix.applyCorrelationShaving(allocations, correlations);
		
		// ETH has lower percentage (12) than BTC (15), and correlation is 0.92 (> 0.85).
		// So ETH's allocation should be shaved down!
		const ethShaved = shaved.find(i => i.asset === 'ETH');
		expect(ethShaved?.percentage).toBeLessThan(12);

		// CASH and BTC should not be shaved down
		const btcAlloc = shaved.find(i => i.asset === 'BTC');
		expect(btcAlloc?.percentage).toBe(15);
	});
});
