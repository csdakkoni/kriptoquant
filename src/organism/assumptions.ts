// ============================================================================
// ORGANISM — Assumption Tests
// ============================================================================
// Each assumption is a belief the system holds. The Assumption Killer's job
// is to try to KILL each one using live market evidence.
// ============================================================================

import type { AssumptionTest, Evidence, Observation, MarketTick } from './types.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function returns(candles: MarketTick[]): number[] {
	const r: number[] = [];
	for (let i = 1; i < candles.length; i++) {
		r.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
	}
	return r;
}

function mean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function autocorrelation(arr: number[], lag: number): number {
	if (arr.length < lag + 10) return NaN;
	const m = mean(arr);
	let num = 0, den = 0;
	for (let i = 0; i < arr.length - lag; i++) {
		num += (arr[i] - m) * (arr[i + lag] - m);
	}
	for (let i = 0; i < arr.length; i++) {
		den += (arr[i] - m) ** 2;
	}
	return den === 0 ? 0 : num / den;
}

function pearson(x: number[], y: number[]): number {
	const n = Math.min(x.length, y.length);
	if (n < 5) return NaN;
	const mx = mean(x.slice(0, n));
	const my = mean(y.slice(0, n));
	let num = 0, dx2 = 0, dy2 = 0;
	for (let i = 0; i < n; i++) {
		const dx = x[i] - mx, dy = y[i] - my;
		num += dx * dy;
		dx2 += dx * dx;
		dy2 += dy * dy;
	}
	const d = Math.sqrt(dx2 * dy2);
	return d === 0 ? 0 : num / d;
}

// ─── Assumption #1: "Trend Exists" ──────────────────────────────────────────
// Null hypothesis: Returns are random (no autocorrelation).
// If autocorrelation is near zero, trend doesn't exist in this timeframe.

export class TrendExistsTest implements AssumptionTest {
	readonly assumptionId = 'trend-exists';

	evaluate(_observations: Observation[], ticks: Map<string, MarketTick[]>): Evidence[] {
		const evidence: Evidence[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 50) continue;

			const r = returns(candles);
			const ac1 = autocorrelation(r, 1);
			const ac2 = autocorrelation(r, 2);
			const ac5 = autocorrelation(r, 5);

			if (isNaN(ac1)) continue;

			// If autocorrelation is significant (>0.1 or <-0.1), trend may exist
			const maxAc = Math.max(Math.abs(ac1), Math.abs(ac2), Math.abs(ac5));

			evidence.push({
				timestamp: Date.now(),
				supports: maxAc > 0.1,
				strength: maxAc,
				description: `${coin}: Autocorrelation lag1=${ac1.toFixed(3)} lag2=${ac2.toFixed(3)} lag5=${ac5.toFixed(3)}. ${maxAc > 0.1 ? 'Some serial dependency detected' : 'Returns appear random — no trend signal'}`,
				data: { coin, ac1, ac2, ac5 },
			});
		}

		return evidence;
	}
}

// ─── Assumption #2: "Coins Are Independent" ─────────────────────────────────
// Null hypothesis: Coins move independently.
// If correlations are high, treating them independently is wrong.

export class CoinsIndependentTest implements AssumptionTest {
	readonly assumptionId = 'coins-are-independent';

	evaluate(_observations: Observation[], ticks: Map<string, MarketTick[]>): Evidence[] {
		const evidence: Evidence[] = [];
		const coinReturns = new Map<string, number[]>();

		for (const [coin, candles] of ticks) {
			if (candles.length < 20) continue;
			coinReturns.set(coin, returns(candles.slice(-20)));
		}

		if (coinReturns.size < 3) return evidence;

		const coins = [...coinReturns.keys()];
		const correlations: number[] = [];

		for (let i = 0; i < coins.length; i++) {
			for (let j = i + 1; j < coins.length; j++) {
				const r1 = coinReturns.get(coins[i])!;
				const r2 = coinReturns.get(coins[j])!;
				const corr = pearson(r1, r2);
				if (!isNaN(corr)) correlations.push(corr);
			}
		}

		if (correlations.length === 0) return evidence;

		const avgCorr = mean(correlations);
		const highCorrPairs = correlations.filter(c => Math.abs(c) > 0.6).length;

		evidence.push({
			timestamp: Date.now(),
			supports: avgCorr < 0.3,
			strength: Math.abs(avgCorr),
			description: `Avg correlation across ${coins.length} coins: ${avgCorr.toFixed(3)}. ${highCorrPairs}/${correlations.length} pairs have |corr|>0.6. ${avgCorr > 0.5 ? 'Coins are NOT independent — they move as one organism' : 'Some independence exists'}`,
			data: { avgCorrelation: avgCorr, highCorrPairs, totalPairs: correlations.length },
		});

		return evidence;
	}
}

// ─── Assumption #3: "Entry Signal Matters" ──────────────────────────────────
// This is tested by comparing actual strategy entries vs random entries.
// We observe: do strategy entries perform better than random entries
// over the NEXT N candles?

export class EntrySignalMattersTest implements AssumptionTest {
	readonly assumptionId = 'entry-signal-matters';
	private randomEntryReturns: number[] = [];
	private tickCount = 0;

	evaluate(_observations: Observation[], ticks: Map<string, MarketTick[]>): Evidence[] {
		const evidence: Evidence[] = [];
		this.tickCount++;

		// Every 10th tick, simulate random entries and measure forward returns
		if (this.tickCount % 10 !== 0) return evidence;

		for (const [coin, candles] of ticks) {
			if (candles.length < 20) continue;

			// Random entry: pick a random point in recent history
			// Look at forward 5-candle return from that point
			const lookback = Math.min(candles.length - 6, 50);
			if (lookback < 5) continue;

			const forwardReturns: number[] = [];
			for (let i = candles.length - lookback - 5; i < candles.length - 5; i++) {
				if (i < 0) continue;
				const fwdReturn = (candles[i + 5].close - candles[i].close) / candles[i].close;
				forwardReturns.push(fwdReturn);
			}

			if (forwardReturns.length < 5) continue;

			const avgFwd = mean(forwardReturns);
			const positiveRatio = forwardReturns.filter(r => r > 0).length / forwardReturns.length;

			this.randomEntryReturns.push(avgFwd);

			// If random entries are roughly 50/50, entry timing doesn't matter
			evidence.push({
				timestamp: Date.now(),
				supports: Math.abs(positiveRatio - 0.5) > 0.1, // entry matters if significantly different from 50/50
				strength: Math.abs(positiveRatio - 0.5) * 2,
				description: `${coin}: Random entry forward returns: avg=${(avgFwd * 100).toFixed(3)}%, win ratio=${(positiveRatio * 100).toFixed(1)}%. ${Math.abs(positiveRatio - 0.5) < 0.1 ? 'Timing appears irrelevant — random is roughly 50/50' : 'Some directional bias detected'}`,
				data: { coin, avgForwardReturn: avgFwd, positiveRatio, sampleSize: forwardReturns.length },
			});
		}

		return evidence;
	}
}

// ─── Assumption #4: "Timeframe Matters" ─────────────────────────────────────
// Does the same signal behave differently on 1m vs 15m vs 1h?
// This test measures if volatility structure changes across timeframes.

export class TimeframeMattersTest implements AssumptionTest {
	readonly assumptionId = 'timeframe-matters';

	evaluate(_observations: Observation[], ticks: Map<string, MarketTick[]>): Evidence[] {
		const evidence: Evidence[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 60) continue;

			const r = returns(candles);

			// Measure mean reversion vs momentum at different lookbacks
			// Short lookback (5): mean reversion tendency?
			// Medium lookback (15): trend tendency?
			const shortAc = autocorrelation(r, 1);
			const medAc = autocorrelation(r, 5);
			const longAc = autocorrelation(r, 15);

			if (isNaN(shortAc) || isNaN(medAc) || isNaN(longAc)) continue;

			// If behavior differs across lookbacks, timeframe matters
			const spread = Math.max(shortAc, medAc, longAc) - Math.min(shortAc, medAc, longAc);

			evidence.push({
				timestamp: Date.now(),
				supports: spread > 0.1,
				strength: spread,
				description: `${coin}: Autocorrelation at different scales — short=${shortAc.toFixed(3)}, mid=${medAc.toFixed(3)}, long=${longAc.toFixed(3)}. Spread=${spread.toFixed(3)}. ${spread > 0.1 ? 'Behavior changes across timescales' : 'Roughly similar at all scales — timeframe may not matter'}`,
				data: { coin, shortAc, medAc, longAc, spread },
			});
		}

		return evidence;
	}
}

// ─── Assumption #5: "Exit Matters More Than Entry" ──────────────────────────
// Compare fixed entry (every N candles) with varying exit rules.
// If exit rule choice produces wider outcome spread than entry choice,
// exit matters more.

export class ExitBeatsEntryTest implements AssumptionTest {
	readonly assumptionId = 'exit-beats-entry';

	evaluate(_observations: Observation[], ticks: Map<string, MarketTick[]>): Evidence[] {
		const evidence: Evidence[] = [];

		for (const [coin, candles] of ticks) {
			if (candles.length < 50) continue;

			// Simulate fixed entry every 10 candles, with different exit rules
			const exits: Record<string, number[]> = {
				'fixed-5': [],   // Exit after 5 candles
				'fixed-10': [],  // Exit after 10 candles
				'fixed-20': [],  // Exit after 20 candles
				'stop-1pct': [], // Exit on 1% loss
			};

			for (let i = 0; i < candles.length - 20; i += 10) {
				const entry = candles[i].close;

				// Fixed exits
				if (i + 5 < candles.length) exits['fixed-5'].push((candles[i + 5].close - entry) / entry);
				if (i + 10 < candles.length) exits['fixed-10'].push((candles[i + 10].close - entry) / entry);
				if (i + 20 < candles.length) exits['fixed-20'].push((candles[i + 20].close - entry) / entry);

				// Stop loss exit
				let stopReturn = 0;
				for (let j = i + 1; j < Math.min(i + 20, candles.length); j++) {
					const ret = (candles[j].close - entry) / entry;
					if (ret <= -0.01) { stopReturn = ret; break; }
					stopReturn = ret;
				}
				exits['stop-1pct'].push(stopReturn);
			}

			// Compare spread of outcomes across exit rules
			const exitMeans = Object.entries(exits)
				.filter(([_, vals]) => vals.length > 0)
				.map(([rule, vals]) => ({ rule, mean: mean(vals) }));

			if (exitMeans.length < 2) continue;

			const means = exitMeans.map(e => e.mean);
			const exitSpread = Math.max(...means) - Math.min(...means);

			evidence.push({
				timestamp: Date.now(),
				supports: exitSpread > 0.005,
				strength: Math.min(exitSpread / 0.02, 1),
				description: `${coin}: Same entry, different exits — spread=${(exitSpread * 100).toFixed(2)}%. ${exitMeans.map(e => `${e.rule}:${(e.mean * 100).toFixed(2)}%`).join(', ')}. ${exitSpread > 0.005 ? 'Exit rule significantly affects outcome' : 'Exit rule makes little difference'}`,
				data: { coin, exitMeans, exitSpread },
			});
		}

		return evidence;
	}
}

/** All available assumption tests */
export function createAllTests(): AssumptionTest[] {
	return [
		new TrendExistsTest(),
		new CoinsIndependentTest(),
		new EntrySignalMattersTest(),
		new TimeframeMattersTest(),
		new ExitBeatsEntryTest(),
	];
}
