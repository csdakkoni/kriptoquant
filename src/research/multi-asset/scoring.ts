// ============================================================================
// KRIPTOQUANT — Cross-Asset Robustness Scoring (Sprint 13)
// ============================================================================
// Konfigüre edilebilir ağırlıklarla Cross-Asset Robustness Score hesaplar.
// ============================================================================

import type { AssetIntervalResult, RobustnessWeights } from './types.js';

function stddev(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

export function calculateCrossAssetScore(
	results: AssetIntervalResult[],
	weights: RobustnessWeights,
): number {
	if (results.length === 0) return 0;

	// 1) overallPassRate: Tüm pencereler içindeki PASS oranı
	let totalWindows = 0;
	let passedWindows = 0;
	for (const res of results) {
		const wins = res.windows;
		totalWindows += wins.length;
		passedWindows += wins.filter((w) => w.passed).length;
	}
	const overallPassRate = totalWindows > 0 ? passedWindows / totalWindows : 0;

	// 2) assetSuccessRatio: Başarılı varlık/zaman dilimi oranı
	const overallPassedCount = results.filter((res) => res.passed).length;
	const assetSuccessRatio = overallPassedCount / results.length;

	// 3) sharpeStability: Sharpe rasyolarının standart sapma kararlılığı (1 / (1 + stddev))
	const testSharpes = results.map((res) => res.avgSharpe);
	const sharpeStdDev = stddev(testSharpes);
	const sharpeStability = 1 / (1 + sharpeStdDev);

	// 4) Drawdown Cezası: Ortalama maksimum drawdown
	const testDrawdowns = results.map((res) => res.avgMaxDrawdown);
	const avgMaxDrawdown = testDrawdowns.reduce((a, b) => a + b, 0) / testDrawdowns.length;

	// Skor Formülü
	const rawScore =
		overallPassRate * weights.passRate +
		assetSuccessRatio * weights.assetSuccess +
		sharpeStability * weights.sharpe -
		avgMaxDrawdown * weights.drawdownPenalty;

	// 0-100 aralığına normalize et
	const score = Math.round(Math.min(100, Math.max(0, rawScore)));
	return score;
}

export function getRobustnessLabel(score: number): string {
	if (score >= 75) return '🟢 ROBUST';
	if (score >= 50) return '🟡 MODERATE';
	if (score >= 30) return '🟠 FRAGILE';
	return '🔴 UNRELIABLE';
}
