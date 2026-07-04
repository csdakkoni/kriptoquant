// ============================================================================
// KRIPTOQUANT — Monte Carlo Risk Engine (Sprint 17)
// ============================================================================
// Trade getirileri üzerinden patika simülasyonları yapar.
// Bağımsız modül: returns dizisi (number[]) ve başlangıç sermayesini alır.
// ============================================================================

import type { MonteCarloStats } from '../../core/types.js';
import { MathRandomGenerator } from '../statistics/rng.js';
import type { RandomGenerator } from '../statistics/rng.js';
import { bootstrapResample, shuffleResample } from '../statistics/resampler.js';
import { nearestRankPercentile } from '../statistics/percentile.js';

/**
 * Monte Carlo risk simülasyonu çalıştırır.
 *
 * @param returns - Yüzdesel getiri dizisi (örn. [5.2, -2.1, 10.5])
 * @param initialCapital - Başlangıç sermayesi (USDT)
 * @param options - Simülasyon opsiyonları
 */
export function runMonteCarlo(
	returns: number[],
	initialCapital: number,
	options: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
		readonly rng?: RandomGenerator;
	} = {},
): MonteCarloStats {
	const method = options.method ?? 'bootstrap';
	const simulationsCount = options.simulationsCount ?? 1000;
	const ruinThresholdPercent = options.ruinThresholdPercent ?? 30;
	const rng = options.rng ?? new MathRandomGenerator();

	if (returns.length === 0) {
		return {
			method,
			simulationsCount,
			ruinThresholdPercent,
			riskOfRuinPercent: 0,
			capitalQuantiles: {
				worst: initialCapital,
				p5: initialCapital,
				p50: initialCapital,
				p95: initialCapital,
				best: initialCapital,
			},
			drawdownQuantiles: {
				p50: 0,
				p95: 0,
				worst: 0,
			},
		};
	}

	const finalCapitals: number[] = [];
	const maxDrawdowns: number[] = [];
	let ruinCount = 0;

	// Belirlenen iflas bakiye sınırı
	const ruinValue = initialCapital * (1 - ruinThresholdPercent / 100);

	for (let sim = 0; sim < simulationsCount; sim++) {
		// Karıştırılmış veya örneklenmiş getiri patikası
		const pathReturns = method === 'bootstrap'
			? bootstrapResample(returns, rng)
			: shuffleResample(returns, rng);

		let currentCapital = initialCapital;
		let peakCapital = initialCapital;
		let pathMaxDrawdown = 0;
		let pathIsRuined = false;

		for (const r of pathReturns) {
			const tradePnl = currentCapital * (r / 100);
			currentCapital += tradePnl;

			if (currentCapital > peakCapital) {
				peakCapital = currentCapital;
			}

			const drawdown = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
			if (drawdown > pathMaxDrawdown) {
				pathMaxDrawdown = drawdown;
			}

			if (currentCapital <= ruinValue) {
				pathIsRuined = true;
			}
		}

		if (pathIsRuined) {
			ruinCount++;
		}

		finalCapitals.push(currentCapital);
		maxDrawdowns.push(pathMaxDrawdown);
	}

	const riskOfRuinPercent = (ruinCount / simulationsCount) * 100;

	// Quantile (yüzdelik dilim) değerleri
	const worstCapital = nearestRankPercentile(finalCapitals, 0); // P0
	const p5Capital = nearestRankPercentile(finalCapitals, 5);     // P5
	const p50Capital = nearestRankPercentile(finalCapitals, 50);   // P50
	const p95Capital = nearestRankPercentile(finalCapitals, 95);   // P95
	const bestCapital = nearestRankPercentile(finalCapitals, 100); // P100

	const p50Drawdown = nearestRankPercentile(maxDrawdowns, 50);
	const p95Drawdown = nearestRankPercentile(maxDrawdowns, 95);
	const worstDrawdown = nearestRankPercentile(maxDrawdowns, 100); // En büyük drawdown

	return {
		method,
		simulationsCount,
		ruinThresholdPercent,
		riskOfRuinPercent: Math.round(riskOfRuinPercent * 100) / 100,
		capitalQuantiles: {
			worst: Math.round(worstCapital * 100) / 100,
			p5: Math.round(p5Capital * 100) / 100,
			p50: Math.round(p50Capital * 100) / 100,
			p95: Math.round(p95Capital * 100) / 100,
			best: Math.round(bestCapital * 100) / 100,
		},
		drawdownQuantiles: {
			p50: Math.round(p50Drawdown * 100) / 100,
			p95: Math.round(p95Drawdown * 100) / 100,
			worst: Math.round(worstDrawdown * 100) / 100,
		},
	};
}
