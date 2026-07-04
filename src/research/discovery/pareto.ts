// ============================================================================
// KRIPTOQUANT — Pareto Front Calculator (Sprint 19)
// ============================================================================

import type { CandidateResult } from './types.js';

/**
 * Adaylar arasından Pareto optimal (Return, Drawdown ve Sharpe)
 * olan, yani başka hiçbir strateji tarafından domine edilmeyen stratejileri seçer.
 *
 * Domine etme kuralı:
 * A stratejisi B'yi domine eder eğer:
 * - A'nın getirisi B'den büyük/eşit,
 * - A'nın drawdown'ı B'den küçük/eşit (yani daha az riskli),
 * - A'nın Sharpe'ı B'den büyük/eşit ise
 * - VE bu üç kriterden en az birinde A kesinlikle B'den daha iyiyse.
 */
export function calculateParetoFront(results: CandidateResult[]): CandidateResult[] {
	const passed = results.filter((r) => r.stage === 'PASSED');
	if (passed.length === 0) {
		return [];
	}

	const pareto: CandidateResult[] = [];

	for (const candidate of passed) {
		let isDominated = false;

		const retA = candidate.totalReturn ?? -999;
		const ddA = candidate.maxDrawdown ?? 999; // Düşük drawdown daha iyi
		const sharpeA = candidate.sharpeRatio ?? -999;

		for (const other of passed) {
			if (candidate.id === other.id) continue;

			const retB = other.totalReturn ?? -999;
			const ddB = other.maxDrawdown ?? 999;
			const sharpeB = other.sharpeRatio ?? -999;

			const otherBetterOrEqual = retB >= retA && ddB <= ddA && sharpeB >= sharpeA;
			const otherStrictlyBetter = retB > retA || ddB < ddA || sharpeB > sharpeA;

			if (otherBetterOrEqual && otherStrictlyBetter) {
				isDominated = true;
				break;
			}
		}

		if (!isDominated) {
			pareto.push(candidate);
		}
	}

	return pareto;
}
