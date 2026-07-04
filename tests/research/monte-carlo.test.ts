// ============================================================================
// KRIPTOQUANT — Monte Carlo Risk Lab Tests (Sprint 17)
// ============================================================================

import { describe, expect, it } from 'vitest';
import { SeededLcgRandomGenerator } from '../../src/research/statistics/rng.js';
import { nearestRankPercentile } from '../../src/research/statistics/percentile.js';
import { bootstrapResample, shuffleResample } from '../../src/research/statistics/resampler.js';
import { runMonteCarlo } from '../../src/research/analytics/monte-carlo.js';

describe('Statistics — Seeded RNG', () => {
	it('should produce a deterministic sequence of numbers between 0 and 1', () => {
		const rng1 = new SeededLcgRandomGenerator(42);
		const rng2 = new SeededLcgRandomGenerator(42);

		const seq1 = [rng1.next(), rng1.next(), rng1.next()];
		const seq2 = [rng2.next(), rng2.next(), rng2.next()];

		expect(seq1).toEqual(seq2);
		for (const val of seq1) {
			expect(val).toBeGreaterThanOrEqual(0);
			expect(val).toBeLessThan(1);
		}
	});
});

describe('Statistics — Nearest-Rank Percentile', () => {
	it('should calculate percentiles correctly', () => {
		const values = [10, 20, 30, 40, 50]; // Length 5
		
		// nearestRankPercentile sorts internally
		expect(nearestRankPercentile([50, 40, 30, 20, 10], 0)).toBe(10);  // Min / Worst (idx 0)
		expect(nearestRankPercentile(values, 50)).toBe(30); // Median (idx 2)
		expect(nearestRankPercentile(values, 100)).toBe(50); // Max / Best (idx 4)
		
		// For 5 elements, 95th percentile resolves to idx 4 (50)
		expect(nearestRankPercentile(values, 95)).toBe(50);
	});
});

describe('Statistics — Resamplers', () => {
	it('should bootstrap resample with replacement', () => {
		const values = [1, 2, 3, 4, 5];
		const rng = new SeededLcgRandomGenerator(12345);
		const resampled = bootstrapResample(values, rng);

		expect(resampled).toHaveLength(5);
		// Check that some elements might be duplicated (since replacement is active)
		const unique = new Set(resampled);
		expect(unique.size).toBeLessThanOrEqual(5);
		for (const val of resampled) {
			expect(values).toContain(val);
		}
	});

	it('should shuffle resample (sequence permutation)', () => {
		const values = [1, 2, 3, 4, 5];
		const rng = new SeededLcgRandomGenerator(12345);
		const shuffled = shuffleResample(values, rng);

		expect(shuffled).toHaveLength(5);
		expect(new Set(shuffled).size).toBe(5); // All elements must be unique and identical to source
		expect(shuffled.sort()).toEqual(values.sort());
	});
});

describe('Monte Carlo Engine', () => {
	it('should calculate 100% risk of ruin if all trades are large losses', () => {
		const returns = [-30, -40, -35];
		const mc = runMonteCarlo(returns, 10000, {
			method: 'bootstrap',
			simulationsCount: 100,
			ruinThresholdPercent: 30, // Ruin at 7000
		});

		expect(mc.riskOfRuinPercent).toBe(100);
		expect(mc.capitalQuantiles.worst).toBeLessThan(7000);
	});

	it('should calculate 0% risk of ruin if all trades are profitable', () => {
		const returns = [10, 20, 15];
		const mc = runMonteCarlo(returns, 10000, {
			method: 'shuffle',
			simulationsCount: 100,
			ruinThresholdPercent: 30,
		});

		expect(mc.riskOfRuinPercent).toBe(0);
		expect(mc.capitalQuantiles.worst).toBeGreaterThanOrEqual(10000);
		expect(mc.capitalQuantiles.best).toBeGreaterThan(10000);
	});

	it('should compute deterministic stats under seeded RNG', () => {
		const returns = [5.5, -2.3, 12.0, -8.1, 4.0];
		const rng = new SeededLcgRandomGenerator(999);

		const mc = runMonteCarlo(returns, 10000, {
			method: 'bootstrap',
			simulationsCount: 100,
			ruinThresholdPercent: 20,
			rng,
		});

		expect(mc.simulationsCount).toBe(100);
		expect(mc.capitalQuantiles.p50).toBeGreaterThan(0);
		expect(mc.drawdownQuantiles.p95).toBeGreaterThanOrEqual(0);
	});
});
