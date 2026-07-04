// ============================================================================
// KRIPTOQUANT — Multi-Asset Aggregator (Sprint 13)
// ============================================================================
// Ham sonuçları toplar, ortalamaları alır ve Cross-Asset Robustness Score
// hesaplayarak bir özet rapor modeli oluşturur.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { AssetIntervalResult, CrossAssetSummary, RobustnessConfig, RobustnessWeights } from './types.js';
import { calculateCrossAssetScore } from './scoring.js';

const DEFAULT_WEIGHTS: RobustnessWeights = {
	passRate: 40,
	assetSuccess: 30,
	sharpe: 30,
	drawdownPenalty: 0.5,
};

function getGitCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
}

export function aggregateResearchResults(
	results: AssetIntervalResult[],
	strategyName: string,
	configPath: string = 'config/robustness.json',
): CrossAssetSummary {
	let weights = DEFAULT_WEIGHTS;

	if (existsSync(configPath)) {
		try {
			const raw = readFileSync(configPath, 'utf-8');
			const parsed = JSON.parse(raw) as RobustnessConfig;
			if (parsed.weights) {
				weights = parsed.weights;
			}
		} catch {
			// fallback to defaults if error reading config
		}
	}

	const totalResults = results.length;
	if (totalResults === 0) {
		return {
			strategyName,
			robustnessScore: 0,
			overallPassRate: 0,
			assetSuccessRatio: 0,
			avgReturn: 0,
			avgSharpe: 0,
			avgMaxDrawdown: 0,
			results: [],
			gitCommit: getGitCommit(),
			timestamp: new Date().toISOString(),
		};
	}

	// overallPassRate calculation
	let totalWindows = 0;
	let passedWindows = 0;
	for (const res of results) {
		totalWindows += res.windows.length;
		passedWindows += res.windows.filter((w) => w.passed).length;
	}
	const overallPassRate = totalWindows > 0 ? passedWindows / totalWindows : 0;

	// assetSuccessRatio calculation
	const overallPassedCount = results.filter((res) => res.passed).length;
	const assetSuccessRatio = overallPassedCount / totalResults;

	// Average calculations
	const returns = results.map((r) => r.avgTestReturn);
	const sharpes = results.map((r) => r.avgSharpe);
	const drawdowns = results.map((r) => r.avgMaxDrawdown);

	const avgReturn = returns.reduce((a, b) => a + b, 0) / totalResults;
	const avgSharpe = sharpes.reduce((a, b) => a + b, 0) / totalResults;
	const avgMaxDrawdown = drawdowns.reduce((a, b) => a + b, 0) / totalResults;

	const robustnessScore = calculateCrossAssetScore(results, weights);

	return {
		strategyName,
		robustnessScore,
		overallPassRate: round(overallPassRate, 4),
		assetSuccessRatio: round(assetSuccessRatio, 4),
		avgReturn: round(avgReturn, 2),
		avgSharpe: round(avgSharpe, 3),
		avgMaxDrawdown: round(avgMaxDrawdown, 2),
		results,
		gitCommit: getGitCommit(),
		timestamp: new Date().toISOString(),
	};
}

function round(val: number, precision: number = 2): number {
	const factor = 10 ** precision;
	return Math.round(val * factor) / factor;
}
