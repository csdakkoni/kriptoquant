import { describe, it, expect } from 'vitest';
import { calculatePairedTTest, calculateWilcoxonSignedRank, adjustPValuesHolm, calculateTradeStats } from '../../src/research/validation-lab.js';

describe('Validation Lab Statistical Tests', () => {
	it('should correctly calculate paired t-test with CI and Cohen d for significant improvement', () => {
		const raw = [0.01, 0.02, 0.015, 0.02, 0.01, 0.015];
		const filtered = [0.03, 0.042, 0.035, 0.038, 0.032, 0.036]; // Diffs: +2.0% to +2.2%

		const result = calculatePairedTTest(raw, filtered);

		expect(result.tStatistic).toBeGreaterThan(2.571); // df=5, t_critical = 2.571
		expect(result.pValue).toBeLessThan(0.05);
		expect(result.isSignificant).toBe(true);
		expect(result.cohensD).toBeGreaterThan(1.0); // Very strong effect size
		expect(result.ciLower).toBeGreaterThan(0.01); // CI should be positive
		expect(result.ciUpper).toBeGreaterThan(result.ciLower);
	});

	it('should return not significant for negative or zero improvement in t-test', () => {
		const raw = [0.02, 0.03, 0.015, 0.025];
		const filtered = [0.01, 0.015, 0.01, 0.02];

		const result = calculatePairedTTest(raw, filtered);

		expect(result.isSignificant).toBe(false);
	});

	it('should correctly calculate Wilcoxon Signed-Rank test for significant improvement', () => {
		const raw = [0.01, 0.02, 0.015, 0.02, 0.01, 0.015];
		const filtered = [0.03, 0.042, 0.035, 0.038, 0.032, 0.036];

		const result = calculateWilcoxonSignedRank(raw, filtered);

		// Since all 6 quarters have positive differences (filtered > raw), positive rank sum is 21 (6*7/2), wStatistic (min) is 0
		expect(result.wStatistic).toBe(0);
		expect(result.isSignificant).toBe(true);
	});

	it('should return not significant for negative or highly volatile Wilcoxon test', () => {
		const raw = [0.01, 0.02, 0.03, 0.04, 0.05];
		const filtered = [0.02, 0.01, 0.04, 0.03, 0.04]; // Non-consistent differences

		const result = calculateWilcoxonSignedRank(raw, filtered);

		expect(result.isSignificant).toBe(false);
	});

	it('should correctly apply Holm-Bonferroni correction to multiple p-values', () => {
		const pValues = [0.01, 0.04, 0.10];
		const adjusted = adjustPValuesHolm(pValues);

		// pValue 0.01 is scaled by multiplier 3 -> 0.03
		expect(adjusted[0]).toBeCloseTo(0.03, 4);
		// pValue 0.04 is scaled by multiplier 2 -> 0.08
		expect(adjusted[1]).toBeCloseTo(0.08, 4);
		// pValue 0.10 is scaled by multiplier 1 -> 0.10
		expect(adjusted[2]).toBeCloseTo(0.10, 4);
	});

	it('should correctly compute trading metrics: payoff ratio, SQN, Kelly %', () => {
		const tradePnls = [1.5, 2.0, -1.0, 3.0, -0.5]; // 3 wins, 2 losses
		const stats = calculateTradeStats(tradePnls, 3);

		expect(stats.payoffRatio).toBeCloseTo(2.8889, 3); // (1.5 + 2.0 + 3.0)/3 = 2.1666. (1.0 + 0.5)/2 = 0.75. Ratio = 2.8889
		expect(stats.sqn).toBeGreaterThan(0);
		expect(stats.kellyPercent).toBeGreaterThan(0);
	});
});
