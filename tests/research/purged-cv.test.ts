import { describe, it, expect, beforeEach } from 'vitest';
import { PurgedCrossValidator } from '../../src/research/purged-cv.js';
import type { Candle } from '../../src/core/types.js';

describe('PurgedCrossValidator Unit Tests', () => {
	let validator: PurgedCrossValidator;

	beforeEach(() => {
		validator = new PurgedCrossValidator();
	});

	it('should generate cross-validation splits and apply purged and embargoed window rules', () => {
		// Mock 120 candles
		const candles: Candle[] = Array.from({ length: 120 }, (_, i) => ({
			openTime: 1000 + i * 60000,
			open: 100 + i,
			high: 102 + i,
			low: 99 + i,
			close: 101 + i,
			volume: 1000,
			closeTime: 1050 + i * 60000,
		}));

		const splits = validator.generatePurgedSplits(candles, 3, 5, 10);
		expect(splits.length).toBe(3);

		splits.forEach(s => {
			expect(s.trainSet.length).toBeGreaterThan(0);
			expect(s.testSet.length).toBeGreaterThan(0);
			
			// Verify training count is reduced due to purging and embargo limits
			expect(s.trainSet.length).toBeLessThan(candles.length - s.testSet.length);
		});
	});

	it('should compute robust stats and save walkforward_stats.json correctly', () => {
		const sharpes = [1.2, 1.5, 0.9];
		const stats = validator.saveWalkforwardStats(sharpes);

		expect(stats.meanSharpe).toBe(1.2);
		expect(stats.medianSharpe).toBe(1.2);
		expect(stats.stdev).toBeCloseTo(0.3, 1);
		expect(stats.ciLower).toBeLessThan(stats.meanSharpe);
	});
});
