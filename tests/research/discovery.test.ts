// ============================================================================
// KRIPTOQUANT — Alpha Discovery Tests (Sprint 19)
// ============================================================================

import { describe, expect, it } from 'vitest';
import { generateCandidates } from '../../src/research/discovery/generator.js';
import { calculateParetoFront } from '../../src/research/discovery/pareto.js';
import type { CandidateResult } from '../../src/research/discovery/types.js';

describe('Alpha Discovery — Generator', () => {
	it('should generate requested number of valid strategy configurations', () => {
		const count = 15;
		const candidates = generateCandidates(count);

		expect(candidates).toHaveLength(count);
		for (const cand of candidates) {
			expect(cand.metadata.name).toBeDefined();
			expect(cand.indicators.length).toBeGreaterThan(0);
			expect(cand.entry).toBeDefined();
			expect(cand.exit).toBeDefined();
		}
	});
});

describe('Alpha Discovery — Pareto Front', () => {
	it('should correctly select non-dominated candidates (Pareto optimal)', () => {
		// Mock results
		const cand1: CandidateResult = {
			id: 'Cand1',
			config: {} as any,
			stage: 'PASSED',
			totalReturn: 50,
			maxDrawdown: 10, // lower drawdown = better
			sharpeRatio: 2.0,
		};
		const cand2: CandidateResult = {
			id: 'Cand2',
			config: {} as any,
			stage: 'PASSED',
			totalReturn: 40,
			maxDrawdown: 12, // dominated by Cand1 on both return and drawdown
			sharpeRatio: 1.8,
		};
		const cand3: CandidateResult = {
			id: 'Cand3',
			config: {} as any,
			stage: 'PASSED',
			totalReturn: 60,
			maxDrawdown: 20, // higher return, higher drawdown (not dominated by Cand1)
			sharpeRatio: 2.5,
		};
		const cand4: CandidateResult = {
			id: 'Cand4',
			config: {} as any,
			stage: 'PASSED',
			totalReturn: 30,
			maxDrawdown: 5, // lower return, lower drawdown (not dominated by Cand1)
			sharpeRatio: 1.5,
		};

		const results = [cand1, cand2, cand3, cand4];
		const pareto = calculateParetoFront(results);

		expect(pareto).toHaveLength(3);
		expect(pareto.map((p) => p.id)).toContain('Cand1');
		expect(pareto.map((p) => p.id)).toContain('Cand3');
		expect(pareto.map((p) => p.id)).toContain('Cand4');
		expect(pareto.map((p) => p.id)).not.toContain('Cand2');
	});
});
