// ============================================================================
// KRIPTOQUANT — Purged & Embargoed Cross-Validation (Sprint 33)
// ============================================================================

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from '../core/types.js';

export interface CrossValidationSplit {
	foldIndex: number;
	trainSet: Candle[];
	testSet: Candle[];
}

export interface WalkforwardStats {
	meanSharpe: number;
	medianSharpe: number;
	stdev: number;
	ciLower: number;
	ciUpper: number;
	worstSharpe: number;
	bestSharpe: number;
	skewness: number;
	kurtosis: number;
	windowsCount: number;
}

export class PurgedCrossValidator {
	private statsPath: string;

	constructor() {
		this.statsPath = join(process.cwd(), 'results', 'walkforward_stats.json');
	}

	/**
	 * Purged and Embargoed splits generator to prevent look-ahead target leakage.
	 * 
	 * @param candles - Mum verileri
	 * @param numFolds - Split sayısı (örn: 3)
	 * @param targetHorizon - Target horizon window size (purging window, örn: 10)
	 * @param embargoHorizon - Ambargo penceresi (embargo window, örn: 15)
	 */
	public generatePurgedSplits(
		candles: Candle[],
		numFolds: number = 3,
		targetHorizon: number = 10,
		embargoHorizon: number = 15
	): CrossValidationSplit[] {
		const totalLength = candles.length;
		if (totalLength < 50) return [];

		const splits: CrossValidationSplit[] = [];
		const foldSize = Math.floor(totalLength / numFolds);

		for (let i = 0; i < numFolds; i++) {
			const testStart = i * foldSize;
			const testEnd = Math.min(totalLength, testStart + foldSize);
			const testSet = candles.slice(testStart, testEnd);

			// Build training candidates
			const trainBeforeTest = candles.slice(0, testStart);
			const trainAfterTest = candles.slice(testEnd);

			// 1) Apply Purging: remove training data overlapping with the test period's target horizon
			// Train segments ending right before test set start are purged by targetHorizon candles
			const purgedBefore = trainBeforeTest.length > targetHorizon 
				? trainBeforeTest.slice(0, trainBeforeTest.length - targetHorizon) 
				: [];

			// 2) Apply Embargoing: remove training data immediately following the test period
			const embargoedAfter = trainAfterTest.length > embargoHorizon
				? trainAfterTest.slice(embargoHorizon)
				: [];

			const trainSet = [...purgedBefore, ...embargoedAfter];

			splits.push({
				foldIndex: i + 1,
				trainSet,
				testSet
			});
		}

		return splits;
	}

	/**
	 * Walkforward istatistiklerini hesaplar ve results/walkforward_stats.json dosyasına kaydeder.
	 */
	public saveWalkforwardStats(sharpes: number[]): WalkforwardStats {
		const n = sharpes.length;
		if (n === 0) {
			const empty = { meanSharpe: 0, medianSharpe: 0, stdev: 0, ciLower: 0, ciUpper: 0, windowsCount: 0 };
			this.writeJson(empty);
			return empty;
		}

		const sum = sharpes.reduce((a, b) => a + b, 0);
		const meanSharpe = sum / n;

		const sorted = [...sharpes].sort((a, b) => a - b);
		const mid = Math.floor(n / 2);
		const medianSharpe = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

		const variance = sharpes.reduce((a, b) => a + Math.pow(b - meanSharpe, 2), 0) / Math.max(1, n - 1);
		const stdev = Math.sqrt(variance);

		const marginOfError = 1.96 * (stdev / Math.sqrt(n));
		const ciLower = meanSharpe - marginOfError;
		const ciUpper = meanSharpe + marginOfError;

		const worstSharpe = Math.min(...sharpes);
		const bestSharpe = Math.max(...sharpes);
		
		// Skewness and Kurtosis moments
		const skewness = sharpes.reduce((a, b) => a + Math.pow(b - meanSharpe, 3), 0) / (n * Math.pow(stdev, 3) || 1);
		const kurtosis = sharpes.reduce((a, b) => a + Math.pow(b - meanSharpe, 4), 0) / (n * Math.pow(stdev, 4) || 1);

		const stats: WalkforwardStats = {
			meanSharpe: parseFloat(meanSharpe.toFixed(3)),
			medianSharpe: parseFloat(medianSharpe.toFixed(3)),
			stdev: parseFloat(stdev.toFixed(3)),
			ciLower: parseFloat(ciLower.toFixed(3)),
			ciUpper: parseFloat(ciUpper.toFixed(3)),
			worstSharpe: parseFloat(worstSharpe.toFixed(3)),
			bestSharpe: parseFloat(bestSharpe.toFixed(3)),
			skewness: parseFloat(skewness.toFixed(3)),
			kurtosis: parseFloat(kurtosis.toFixed(3)),
			windowsCount: n
		};

		this.writeJson(stats);
		return stats;
	}

	private writeJson(stats: WalkforwardStats): void {
		try {
			const dir = join(process.cwd(), 'results');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(this.statsPath, JSON.stringify(stats, null, 4));
		} catch {}
	}
}
