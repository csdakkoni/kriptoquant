// ============================================================================
// KRIPTOQUANT — Walk-Forward Validation Engine (Sprint 31)
// ============================================================================

import type { Candle } from '../core/types.js';

export interface PartitionWindow {
	windowIndex: number;
	inSample: Candle[];
	outOfSample: Candle[];
}

export class WalkForwardEngine {
	/**
	 * Zaman serisi mum verilerini rolling/sliding window mantığıyla IS ve OOS pencerelerine böler.
	 * 
	 * @param candles - Mum verileri
	 * @param trainRatio - In-Sample eğitim oranı (örn: 0.70)
	 * @param numWindows - Oluşturulacak kayan pencere sayısı (örn: 3)
	 */
	public generateWindows(
		candles: Candle[],
		trainRatio: number = 0.70,
		numWindows: number = 3
	): PartitionWindow[] {
		const totalLength = candles.length;
		if (totalLength < 20) return [];

		const windows: PartitionWindow[] = [];
		
		// Kayan pencere boyutunu belirle
		const windowSize = Math.floor(totalLength / (numWindows + 1) * 2);
		const stepSize = Math.floor((totalLength - windowSize) / Math.max(1, numWindows - 1));

		for (let i = 0; i < numWindows; i++) {
			const start = i * stepSize;
			const end = Math.min(totalLength, start + windowSize);
			
			const segment = candles.slice(start, end);
			const segmentLen = segment.length;
			if (segmentLen < 10) continue;

			const splitIdx = Math.floor(segmentLen * trainRatio);
			const inSample = segment.slice(0, splitIdx);
			const outOfSample = segment.slice(splitIdx);

			windows.push({
				windowIndex: i + 1,
				inSample,
				outOfSample
			});
		}

		return windows;
	}

	/**
	 * Çoklu pencerelerden elde edilen out-of-sample Sharpe oranlarının dağılım istatistiklerini hesaplar.
	 */
	public calculateOosStatistics(sharpes: number[]) {
		const n = sharpes.length;
		if (n === 0) return { mean: 0, median: 0, stdev: 0, ciLower: 0, ciUpper: 0 };

		// 1) Mean
		const sum = sharpes.reduce((a, b) => a + b, 0);
		const mean = sum / n;

		// 2) Median
		const sorted = [...sharpes].sort((a, b) => a - b);
		const mid = Math.floor(n / 2);
		const median = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

		// 3) Standard Deviation
		const variance = sharpes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, n - 1);
		const stdev = Math.sqrt(variance);

		// 4) 95% Confidence Interval: CI = mean +/- 1.96 * (stdev / sqrt(n))
		const marginOfError = 1.96 * (stdev / Math.sqrt(n));
		const ciLower = mean - marginOfError;
		const ciUpper = mean + marginOfError;

		return {
			mean: parseFloat(mean.toFixed(3)),
			median: parseFloat(median.toFixed(3)),
			stdev: parseFloat(stdev.toFixed(3)),
			ciLower: parseFloat(ciLower.toFixed(3)),
			ciUpper: parseFloat(ciUpper.toFixed(3))
		};
	}
}
