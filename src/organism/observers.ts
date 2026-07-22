// ============================================================================
// ORGANISM — Observers (Relationship Detectors)
// ============================================================================
// Observers don't read raw data. They read RELATIONSHIPS.
// "Funding spiked" is data. "Funding spiked but price didn't react" is observation.
// ============================================================================

import type { Observer, Observation, MarketTick } from './types.js';
import { randomUUID } from 'node:crypto';

// ─── Utility ─────────────────────────────────────────────────────────────────

function returns(candles: MarketTick[]): number[] {
	const r: number[] = [];
	for (let i = 1; i < candles.length; i++) {
		r.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
	}
	return r;
}

function mean(arr: number[]): number {
	return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
	const m = mean(arr);
	return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// ─── Divergence Observer ─────────────────────────────────────────────────────
// Detects when two things that should move together, don't.
// Example: Volume spikes but price stays flat. Funding spikes but price doesn't react.

export class DivergenceObserver implements Observer {
	readonly name = 'DivergenceObserver';
	readonly description = 'Detects when volume and price diverge — high volume without price movement or vice versa';

	observe(ticks: Map<string, MarketTick[]>): Observation[] {
		const observations: Observation[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 10) continue;

			const recent = candles.slice(-5);
			const history = candles.slice(-20, -5);

			if (history.length < 5) continue;

			// Volume vs Price divergence
			const recentVolMean = mean(recent.map(c => c.volume));
			const historyVolMean = mean(history.map(c => c.volume));
			const volRatio = recentVolMean / (historyVolMean || 1);

			const recentPriceRange = Math.abs(recent[recent.length - 1].close - recent[0].close) / recent[0].close;
			const historyPriceRange = Math.abs(history[history.length - 1].close - history[0].close) / (history[0].close || 1);
			const priceRatio = recentPriceRange / (historyPriceRange || 0.001);

			// High volume but low price movement
			if (volRatio > 2.0 && priceRatio < 0.5) {
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'divergence',
					description: `${coin}: Volume ${volRatio.toFixed(1)}x normal but price movement only ${(priceRatio * 100).toFixed(0)}% of normal`,
					confidence: Math.min(volRatio / 4, 1),
					coins: [coin],
					relatedData: { volRatio, priceRatio, recentVolMean, historyVolMean },
				});
			}

			// Low volume but high price movement
			if (volRatio < 0.5 && priceRatio > 2.0) {
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'divergence',
					description: `${coin}: Price moved ${priceRatio.toFixed(1)}x normal but volume only ${(volRatio * 100).toFixed(0)}% of normal`,
					confidence: Math.min(priceRatio / 4, 1),
					coins: [coin],
					relatedData: { volRatio, priceRatio },
				});
			}
		}

		return observations;
	}
}

// ─── Silence Observer ────────────────────────────────────────────────────────
// Detects abnormal lack of movement. Silence before storms.
// The most interesting moments are often when NOTHING happens.

export class SilenceObserver implements Observer {
	readonly name = 'SilenceObserver';
	readonly description = 'Detects abnormal volatility compression — when the market goes unusually quiet';

	observe(ticks: Map<string, MarketTick[]>): Observation[] {
		const observations: Observation[] = [];
		const silentCoins: string[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 30) continue;

			const recentReturns = returns(candles.slice(-10));
			const historicalReturns = returns(candles.slice(-30, -10));

			if (recentReturns.length < 5 || historicalReturns.length < 5) continue;

			const recentVol = stddev(recentReturns);
			const historicalVol = stddev(historicalReturns);
			const volRatio = recentVol / (historicalVol || 0.0001);

			// Volatility compressed to less than 30% of normal
			if (volRatio < 0.3) {
				silentCoins.push(coin);
			}
		}

		// Market-wide silence is more interesting than single-coin silence
		if (silentCoins.length >= 3) {
			observations.push({
				id: randomUUID(),
				timestamp: Date.now(),
				type: 'silence',
				description: `Market-wide silence detected: ${silentCoins.length} coins showing compressed volatility (<30% of normal)`,
				confidence: Math.min(silentCoins.length / 8, 1),
				coins: silentCoins,
				relatedData: { silentCount: silentCoins.length },
			});
		} else if (silentCoins.length > 0) {
			for (const coin of silentCoins) {
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'silence',
					description: `${coin}: Unusual silence — volatility compressed below 30% of recent history`,
					confidence: 0.5,
					coins: [coin],
					relatedData: {},
				});
			}
		}

		return observations;
	}
}

// ─── Herd Observer ───────────────────────────────────────────────────────────
// Detects when all coins move in lockstep (herd behavior)
// or when one coin diverges from the pack (isolation).

export class HerdObserver implements Observer {
	readonly name = 'HerdObserver';
	readonly description = 'Detects herd behavior (all coins moving together) and isolation (one coin diverging)';

	observe(ticks: Map<string, MarketTick[]>): Observation[] {
		const observations: Observation[] = [];

		// Get recent returns for all coins
		const coinReturns = new Map<string, number[]>();
		for (const [coin, candles] of ticks) {
			if (candles.length < 10) continue;
			const r = returns(candles.slice(-10));
			if (r.length >= 5) coinReturns.set(coin, r);
		}

		if (coinReturns.size < 3) return observations;

		// Calculate pairwise correlations
		const coins = [...coinReturns.keys()];
		const correlations: number[] = [];

		for (let i = 0; i < coins.length; i++) {
			for (let j = i + 1; j < coins.length; j++) {
				const r1 = coinReturns.get(coins[i])!;
				const r2 = coinReturns.get(coins[j])!;
				const len = Math.min(r1.length, r2.length);
				const corr = pearsonCorrelation(r1.slice(0, len), r2.slice(0, len));
				if (!isNaN(corr)) correlations.push(corr);
			}
		}

		if (correlations.length === 0) return observations;

		const avgCorr = mean(correlations);

		// Herd behavior: average correlation > 0.8
		if (avgCorr > 0.8) {
			observations.push({
				id: randomUUID(),
				timestamp: Date.now(),
				type: 'herd',
				description: `Herd behavior detected: ${coins.length} coins showing avg correlation ${avgCorr.toFixed(2)} — market is moving as one`,
				confidence: Math.min((avgCorr - 0.6) / 0.4, 1),
				coins,
				relatedData: { avgCorrelation: avgCorr, pairCount: correlations.length },
			});
		}

		// Check for isolation: one coin's avg correlation much lower than others
		for (const coin of coins) {
			const coinCorrs: number[] = [];
			for (const other of coins) {
				if (other === coin) continue;
				const r1 = coinReturns.get(coin)!;
				const r2 = coinReturns.get(other)!;
				const len = Math.min(r1.length, r2.length);
				const corr = pearsonCorrelation(r1.slice(0, len), r2.slice(0, len));
				if (!isNaN(corr)) coinCorrs.push(corr);
			}

			if (coinCorrs.length === 0) continue;
			const coinAvgCorr = mean(coinCorrs);

			// This coin is diverging from the pack
			if (coinAvgCorr < 0.2 && avgCorr > 0.5) {
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'isolation',
					description: `${coin} is diverging from the herd: its avg correlation is ${coinAvgCorr.toFixed(2)} vs market avg ${avgCorr.toFixed(2)}`,
					confidence: Math.min((avgCorr - coinAvgCorr) / 0.5, 1),
					coins: [coin],
					relatedData: { coinCorrelation: coinAvgCorr, marketCorrelation: avgCorr },
				});
			}
		}

		return observations;
	}
}

// ─── Surprise Observer ───────────────────────────────────────────────────────
// Detects when reality differs significantly from recent behavior.
// The most valuable moments are when ALL expectations are wrong simultaneously.

export class SurpriseObserver implements Observer {
	readonly name = 'SurpriseObserver';
	readonly description = 'Detects when price action is statistically surprising relative to recent history';

	observe(ticks: Map<string, MarketTick[]>): Observation[] {
		const observations: Observation[] = [];
		const surprisedCoins: string[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 30) continue;

			const hist = returns(candles.slice(-30, -1));
			if (hist.length < 10) continue;

			const lastReturn = (candles[candles.length - 1].close - candles[candles.length - 2].close) / candles[candles.length - 2].close;
			const mu = mean(hist);
			const sigma = stddev(hist);

			if (sigma === 0) continue;

			const zScore = Math.abs((lastReturn - mu) / sigma);

			// Z-score > 3 means this move is very unusual
			if (zScore > 3) {
				surprisedCoins.push(coin);
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'surprise',
					description: `${coin}: Surprising move — ${(lastReturn * 100).toFixed(2)}% return has z-score ${zScore.toFixed(1)} (>3σ from recent mean)`,
					confidence: Math.min(zScore / 5, 1),
					coins: [coin],
					relatedData: { zScore, lastReturn, recentMean: mu, recentStddev: sigma },
				});
			}
		}

		// Market-wide surprise is even more notable
		if (surprisedCoins.length >= 3) {
			observations.push({
				id: randomUUID(),
				timestamp: Date.now(),
				type: 'surprise',
				description: `Market-wide surprise: ${surprisedCoins.length} coins simultaneously showing >3σ moves`,
				confidence: 1,
				coins: surprisedCoins,
				relatedData: { surprisedCount: surprisedCoins.length },
			});
		}

		return observations;
	}
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function pearsonCorrelation(x: number[], y: number[]): number {
	const n = Math.min(x.length, y.length);
	if (n < 3) return NaN;

	const mx = mean(x.slice(0, n));
	const my = mean(y.slice(0, n));

	let num = 0, dx2 = 0, dy2 = 0;
	for (let i = 0; i < n; i++) {
		const dx = x[i] - mx;
		const dy = y[i] - my;
		num += dx * dy;
		dx2 += dx * dx;
		dy2 += dy * dy;
	}

	const denom = Math.sqrt(dx2 * dy2);
	return denom === 0 ? 0 : num / denom;
}

// ─── Liquidity Wick Observer ──────────────────────────────────────────────────
// Detects long wicks which often signify liquidity hunting/stop cascades.

export class LiquidityWickObserver implements Observer {
	readonly name = 'LiquidityWickObserver';
	readonly description = 'Detects candles with disproportionately long wicks (liquidity sweeps)';

	observe(ticks: Map<string, MarketTick[]>): Observation[] {
		const observations: Observation[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 20) continue;
			
			const c = candles[candles.length - 1];
			const body = Math.abs(c.close - c.open) || 0.0001; // prevent div 0
			const upperWick = c.high - Math.max(c.open, c.close);
			const lowerWick = Math.min(c.open, c.close) - c.low;
			
			const totalRange = c.high - c.low || 0.0001;
			const isHighVolume = c.volume > mean(candles.slice(-20, -1).map(x => x.volume)) * 1.5;

			if (upperWick > body * 3 && upperWick > totalRange * 0.5 && isHighVolume) {
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'liquidity_sweep_high',
					description: `${coin}: Upper liquidity sweep (wick ${(upperWick/body).toFixed(1)}x body) on high volume`,
					confidence: Math.min(upperWick / body / 10, 1),
					coins: [coin],
					relatedData: { upperWick, body, totalRange, isHighVolume },
				});
			}

			if (lowerWick > body * 3 && lowerWick > totalRange * 0.5 && isHighVolume) {
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'liquidity_sweep_low',
					description: `${coin}: Lower liquidity sweep (wick ${(lowerWick/body).toFixed(1)}x body) on high volume`,
					confidence: Math.min(lowerWick / body / 10, 1),
					coins: [coin],
					relatedData: { lowerWick, body, totalRange, isHighVolume },
				});
			}
		}

		return observations;
	}
}

// ─── Bollinger Squeeze Observer ──────────────────────────────────────────────
// Detects extreme volatility compression (the calm before the storm).

export class BollingerSqueezeObserver implements Observer {
	readonly name = 'BollingerSqueezeObserver';
	readonly description = 'Detects volatility compression where recent stddev is far below historical stddev';

	observe(ticks: Map<string, MarketTick[]>): Observation[] {
		const observations: Observation[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 100) continue;
			
			const historicalCloses = candles.slice(-100).map(c => c.close);
			const recentCloses = candles.slice(-20).map(c => c.close);
			
			const histStdDev = stddev(historicalCloses);
			const recentStdDev = stddev(recentCloses);
			
			// If recent volatility is less than half of historical volatility
			if (recentStdDev > 0 && histStdDev > 0 && recentStdDev < histStdDev * 0.5) {
				const ratio = recentStdDev / histStdDev;
				observations.push({
					id: randomUUID(),
					timestamp: Date.now(),
					type: 'volatility_squeeze',
					description: `${coin}: Extreme volatility squeeze (recent stddev is ${(ratio * 100).toFixed(0)}% of historical)`,
					confidence: 1.0 - ratio, // lower ratio = higher confidence
					coins: [coin],
					relatedData: { recentStdDev, histStdDev, ratio },
				});
			}
		}

		return observations;
	}
}
