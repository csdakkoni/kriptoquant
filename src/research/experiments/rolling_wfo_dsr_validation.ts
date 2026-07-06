import { runBacktest } from '../backtester.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import type { Candle, PlatformConfig, RiskConfig } from '../../../core/types.js';
import { getCandles } from '../../data/binance-client.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';

// ─── Strategy Builder Helper ──────────────────────────────────────────────────
function buildDonchianStrategy(period: number) {
	return createDonchianBreakoutStrategy(period);
}

// ─── Normal CDF and Inverse CDF Helpers ────────────────────────────────────────
function normalCDF(z: number): number {
	const t = 1 / (1 + 0.2316419 * Math.abs(z));
	const d = 0.3989422804; // 1 / sqrt(2*pi)
	const p = d * Math.exp(-0.5 * z * z) * ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.31938153) * t;
	if (z > 0) return 1 - p;
	return p;
}

function inverseNormalCDF(p: number): number {
	if (p <= 0 || p >= 1) return 0;
	const c0 = 2.515517;
	const c1 = 0.802853;
	const c2 = 0.010328;
	const d1 = 1.432788;
	const d2 = 0.189269;
	const d3 = 0.001308;
	
	let t = 0;
	if (p < 0.5) {
		t = Math.sqrt(-2.0 * Math.log(p));
		return -(t - ((c2 * t + c1) * t + c0) / (((d3 * t + d2) * t + d1) * t + 1.0));
	} else {
		t = Math.sqrt(-2.0 * Math.log(1.0 - p));
		return t - ((c2 * t + c1) * t + c0) / (((d3 * t + d2) * t + d1) * t + 1.0);
	}
}

// ─── Skewness & Kurtosis Helper ──────────────────────────────────────────────
function calculateSkewnessAndKurtosis(returns: number[]) {
	const n = returns.length;
	if (n < 3) return { skewness: 0, kurtosis: 3 };
	
	const mean = returns.reduce((s, x) => s + x, 0) / n;
	const variance = returns.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (n - 1);
	const stdDev = Math.sqrt(variance);
	
	if (stdDev === 0) return { skewness: 0, kurtosis: 3 };
	
	const skewness = (returns.reduce((s, x) => s + Math.pow(x - mean, 3), 0) / n) / Math.pow(stdDev, 3);
	const kurtosis = (returns.reduce((s, x) => s + Math.pow(x - mean, 4), 0) / n) / Math.pow(stdDev, 4);
	
	return { skewness, kurtosis };
}

// ─── Pearson Correlation Helper ───────────────────────────────────────────────
function calculatePearsonCorrelation(x: number[], y: number[]): number {
	const n = x.length;
	if (n === 0 || n !== y.length) return 0;
	
	const meanX = x.reduce((s, val) => s + val, 0) / n;
	const meanY = y.reduce((s, val) => s + val, 0) / n;
	
	let num = 0;
	let denX = 0;
	let denY = 0;
	
	for (let i = 0; i < n; i++) {
		const diffX = x[i] - meanX;
		const diffY = y[i] - meanY;
		num += diffX * diffY;
		denX += diffX * diffX;
		denY += diffY * diffY;
	}
	
	if (denX === 0 || denY === 0) return 0;
	return num / Math.sqrt(denX * denY);
}

// ─── Advanced Overlap Helper ──────────────────────────────────────────────────
interface AdvancedJaccardResult {
	readonly entryJaccard: number;
	readonly exitJaccard: number;
	readonly holdingCorr: number;
	readonly pnlCorr: number;
}

function calculateAdvancedJaccard(tradesA: any[], tradesB: any[]): AdvancedJaccardResult {
	if (tradesA.length === 0 || tradesB.length === 0) {
		return { entryJaccard: 0, exitJaccard: 0, holdingCorr: 0, pnlCorr: 0 };
	}

	const matchedPairs: { tA: any; tB: any }[] = [];
	const matchedInB = new Set<number>();

	for (const tA of tradesA) {
		const matchIdx = tradesB.findIndex((tB, idx) => {
			if (matchedInB.has(idx)) return false;
			const diff = Math.abs(tA.entryOrder.timestamp - tB.entryOrder.timestamp);
			return diff <= 4 * 3600 * 1000; // 4 hours
		});

		if (matchIdx !== -1) {
			matchedPairs.push({ tA, tB: tradesB[matchIdx] });
			matchedInB.add(matchIdx);
		}
	}

	const entryMatches = matchedPairs.length;
	const entryJaccard = entryMatches / (tradesA.length + tradesB.length - entryMatches);

	// Exit matches
	let exitMatches = 0;
	const exitMatchedInB = new Set<number>();
	for (const tA of tradesA) {
		const matchIdx = tradesB.findIndex((tB, idx) => {
			if (exitMatchedInB.has(idx)) return false;
			const diff = Math.abs(tA.exitOrder.timestamp - tB.exitOrder.timestamp);
			return diff <= 4 * 3600 * 1000; // 4 hours
		});
		if (matchIdx !== -1) {
			exitMatches++;
			exitMatchedInB.add(matchIdx);
		}
	}
	const exitJaccard = exitMatches / (tradesA.length + tradesB.length - exitMatches);

	// Correlations
	if (matchedPairs.length >= 2) {
		const holdingsA = matchedPairs.map(p => p.tA.holdingPeriod);
		const holdingsB = matchedPairs.map(p => p.tB.holdingPeriod);
		const pnlsA = matchedPairs.map(p => p.tA.pnlPercent);
		const pnlsB = matchedPairs.map(p => p.tB.pnlPercent);

		const holdingCorr = calculatePearsonCorrelation(holdingsA, holdingsB);
		const pnlCorr = calculatePearsonCorrelation(pnlsA, pnlsB);

		return { entryJaccard, exitJaccard, holdingCorr, pnlCorr };
	}

	return { entryJaccard, exitJaccard, holdingCorr: 0, pnlCorr: 0 };
}

// ─── Authentic Deflated Sharpe Ratio (DSR) Helper ─────────────────────────────
function calculateAuthenticDSR(
	observedSharpe: number,
	trialsCount: number,
	sharpeVariance: number,
	sampleYears: number,
	avgCorrelation: number,
	skewness: number,
	kurtosis: number,
	tradesCount: number
) {
	if (sharpeVariance <= 0) return { dsrProbability: 0.5, expectedMaxSharpe: 0, nEff: 1 };
	
	// Estimate effective independent trials (N_eff)
	const nEff = Math.max(1, trialsCount * (1 - avgCorrelation) + avgCorrelation);
	
	const euler = 0.5772156649;
	const p1 = 1 - 1 / nEff;
	const p2 = 1 - 1 / (nEff * Math.exp(1));
	
	const z1 = inverseNormalCDF(p1);
	const z2 = inverseNormalCDF(p2);
	
	const stdDevSharpe = Math.sqrt(sharpeVariance);
	const expectedMaxSharpe = stdDevSharpe * ((1 - euler) * z1 + euler * z2);
	
	// DSR Z-score computation adjusting for Skewness, Kurtosis, and sample trades length
	const num = (observedSharpe - expectedMaxSharpe) * Math.sqrt(tradesCount - 1);
	const den = Math.sqrt(1 - skewness * observedSharpe + ((kurtosis - 1) / 4) * Math.pow(observedSharpe, 2));
	
	const z = den > 0 ? num / den : 0;
	const dsrProbability = normalCDF(z);
	
	return {
		dsrProbability,
		expectedMaxSharpe,
		nEff
	};
}

async function run() {
	const platformConfig: PlatformConfig = {
		initialCapital: 10000,
		commissionPercent: 0.10,
		slippagePercent: 0.05
	};

	const rawDefaults = {
		strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
		filters: { adxPeriod: 14, adxVetoThreshold: 25, rvolLookback: 20, rvolVetoThreshold: 2.0 }, // Strict filter
		confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: 80 }
	};

	const startTime = new Date('2022-01-01T00:00:00Z').getTime();
	const endTime = new Date('2026-07-06T23:59:59Z').getTime();

	console.log("[Validation Engine] Loading historical data (2022-2026)...");
	const ethCandles = await getCandles('ETHUSDT', '4h', startTime, endTime);
	const nearCandles = await getCandles('NEARUSDT', '4h', startTime, endTime);

	const ethRisk: RiskConfig = { maxPositionPercent: 100, maxDailyLossPercent: 100, maxOrderValue: 10000, stopLossPercent: 0.03, takeProfitPercent: 0.10, stopLossAtrMultiplier: 1.5 };
	const nearRisk: RiskConfig = { maxPositionPercent: 100, maxDailyLossPercent: 100, maxOrderValue: 10000, stopLossPercent: 0.05, takeProfitPercent: 0.10, stopLossAtrMultiplier: 1.5 };

	// ─── RUN CANDIDATES ───────────────────────────────────────────────────────
	const eth50 = runBacktest(buildDonchianStrategy(50), ethCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
	const eth48 = runBacktest(buildDonchianStrategy(48), ethCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
	
	const near20 = runBacktest(buildDonchianStrategy(20), nearCandles, platformConfig, nearRisk, 'NEARUSDT', rawDefaults);
	const near18 = runBacktest(buildDonchianStrategy(18), nearCandles, platformConfig, nearRisk, 'NEARUSDT', rawDefaults);

	// ─── TEST 1: Advanced Jaccard Trade Overlap ──────────────────────────────
	console.log("\n[Test 1] Calculating Advanced Jaccard Overlaps & Correlations...");
	const ethAdv = calculateAdvancedJaccard(eth50.trades, eth48.trades);
	const nearAdv = calculateAdvancedJaccard(near20.trades, near18.trades);

	// ─── TEST 2: Deflated Sharpe Ratio (DSR) with Return Correlations ──────────
	console.log("\n[Test 2] Estimating Deflated Sharpe Ratio with Multi-Trial Return Correlations...");
	
	const periods = [10, 15, 20, 25, 30, 40, 50];
	const sls = [0.03, 0.05];
	const tps = [0.10];
	const atrs = [1.5, 2.0];
	const filters = [
		{ adx: 20, rvol: 1.5, minConf: 70 },
		{ adx: 25, rvol: 2.0, minConf: 80 }
	];

	const ethSharpes: number[] = [];
	const nearSharpes: number[] = [];
	
	const ethReturnSeries: number[][] = [];
	const nearReturnSeries: number[][] = [];

	for (const p of periods) {
		const ethStrat = buildDonchianStrategy(p);
		const nearStrat = buildDonchianStrategy(p);

		for (const sl of sls) {
			for (const tp of tps) {
				for (const atr of atrs) {
					for (const filter of filters) {
						const strategyDefaults = {
							strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
							filters: { adxPeriod: 14, adxVetoThreshold: filter.adx, rvolLookback: 20, rvolVetoThreshold: filter.rvol },
							confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: filter.minConf }
						};

						try {
							const resEth = runBacktest(ethStrat, ethCandles, platformConfig, { maxPositionPercent: 100, maxDailyLossPercent: 100, maxOrderValue: 10000, stopLossPercent: sl, takeProfitPercent: tp, stopLossAtrMultiplier: atr }, 'ETHUSDT', strategyDefaults);
							if (resEth.totalTrades > 0) {
								ethSharpes.push(resEth.sharpeRatio);
								const rets: number[] = [];
								for (let i = 1; i < resEth.equityCurve.length; i++) {
									rets.push((resEth.equityCurve[i].equity - resEth.equityCurve[i-1].equity) / resEth.equityCurve[i-1].equity);
								}
								ethReturnSeries.push(rets);
							}
						} catch(e){}

						try {
							const resNear = runBacktest(nearStrat, nearCandles, platformConfig, { maxPositionPercent: 100, maxDailyLossPercent: 100, maxOrderValue: 10000, stopLossPercent: sl, takeProfitPercent: tp, stopLossAtrMultiplier: atr }, 'NEARUSDT', strategyDefaults);
							if (resNear.totalTrades > 0) {
								nearSharpes.push(resNear.sharpeRatio);
								const rets: number[] = [];
								for (let i = 1; i < resNear.equityCurve.length; i++) {
									rets.push((resNear.equityCurve[i].equity - resNear.equityCurve[i-1].equity) / resNear.equityCurve[i-1].equity);
								}
								nearReturnSeries.push(rets);
							}
						} catch(e){}
					}
				}
			}
		}
	}

	const getVariance = (arr: number[]) => {
		const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
		return arr.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / (arr.length - 1);
	};

	const getAvgPairwiseCorrelation = (seriesList: number[][]) => {
		if (seriesList.length <= 1) return 1.0;
		let totalCorr = 0;
		let count = 0;
		const subset = seriesList.slice(0, 50);
		for (let i = 0; i < subset.length; i++) {
			for (let j = i + 1; j < subset.length; j++) {
				totalCorr += calculatePearsonCorrelation(subset[i], subset[j]);
				count++;
			}
		}
		return count > 0 ? totalCorr / count : 1.0;
	};

	const ethVar = getVariance(ethSharpes);
	const nearVar = getVariance(nearSharpes);

	const ethAvgCorr = getAvgPairwiseCorrelation(ethReturnSeries);
	const nearAvgCorr = getAvgPairwiseCorrelation(nearReturnSeries);

	const totalTrials = 640;
	const sampleYears = 4.5;

	// Calculate daily returns for candidate strategies to get Skewness & Kurtosis
	const ethCandReturns = [];
	for (let i = 1; i < eth50.equityCurve.length; i++) {
		ethCandReturns.push((eth50.equityCurve[i].equity - eth50.equityCurve[i-1].equity) / eth50.equityCurve[i-1].equity);
	}
	const nearCandReturns = [];
	for (let i = 1; i < near20.equityCurve.length; i++) {
		nearCandReturns.push((near20.equityCurve[i].equity - near20.equityCurve[i-1].equity) / near20.equityCurve[i-1].equity);
	}

	const ethMoments = calculateSkewnessAndKurtosis(ethCandReturns);
	const nearMoments = calculateSkewnessAndKurtosis(nearCandReturns);

	const ethDsrObj = calculateAuthenticDSR(
		eth50.sharpeRatio, totalTrials, ethVar, sampleYears, ethAvgCorr,
		ethMoments.skewness, ethMoments.kurtosis, eth50.totalTrades
	);

	const nearDsrObj = calculateAuthenticDSR(
		near20.sharpeRatio, totalTrials, nearVar, sampleYears, nearAvgCorr,
		nearMoments.skewness, nearMoments.kurtosis, near20.totalTrades
	);

	console.log(`\n🛡️ AUTHENTIC DEFLATED SHARPE RATIO (DSR) RESULTS:`);
	console.log(`  ETHUSDT Donchian-50:`);
	console.log(`    - Observed Sharpe : ${eth50.sharpeRatio.toFixed(3)}`);
	console.log(`    - Skewness        : ${ethMoments.skewness.toFixed(4)}`);
	console.log(`    - Kurtosis        : ${ethMoments.kurtosis.toFixed(4)}`);
	console.log(`    - Expected Max SR : ${ethDsrObj.expectedMaxSharpe.toFixed(3)}`);
	console.log(`    - DSR Probability : ${(ethDsrObj.dsrProbability * 100).toFixed(2)}%`);
	
	console.log(`  NEARUSDT Donchian-20:`);
	console.log(`    - Observed Sharpe : ${near20.sharpeRatio.toFixed(3)}`);
	console.log(`    - Skewness        : ${nearMoments.skewness.toFixed(4)}`);
	console.log(`    - Kurtosis        : ${nearMoments.kurtosis.toFixed(4)}`);
	console.log(`    - Expected Max SR : ${nearDsrObj.expectedMaxSharpe.toFixed(3)}`);
	console.log(`    - DSR Probability : ${(nearDsrObj.dsrProbability * 100).toFixed(2)}%`);

	// ─── TEST 3: Multi-Window Rolling WFO (4 Windows) ─────────────────────────
	const windows = [
		{ name: "Pencere 1", trainStart: "2022-01-01", trainEnd: "2022-12-31", testStart: "2023-01-01", testEnd: "2023-12-31" },
		{ name: "Pencere 2", trainStart: "2022-01-01", trainEnd: "2023-12-31", testStart: "2024-01-01", testEnd: "2024-12-31" },
		{ name: "Pencere 3", trainStart: "2023-01-01", trainEnd: "2024-12-31", testStart: "2025-01-01", testEnd: "2025-12-31" },
		{ name: "Pencere 4", trainStart: "2024-01-01", trainEnd: "2025-12-31", testStart: "2026-01-01", testEnd: "2026-07-06" }
	];

	const rWfoResults = [];

	for (const win of windows) {
		const trainStartTs = new Date(`${win.trainStart}T00:00:00Z`).getTime();
		const trainEndTs = new Date(`${win.trainEnd}T23:59:59Z`).getTime();
		const testStartTs = new Date(`${win.testStart}T00:00:00Z`).getTime();
		const testEndTs = new Date(`${win.testEnd}T23:59:59Z`).getTime();

		const trainCandles = ethCandles.filter(c => c.openTime >= trainStartTs && c.openTime <= trainEndTs);
		const testCandles = ethCandles.filter(c => c.openTime >= testStartTs && c.openTime <= testEndTs);

		let bestPeriod = 50;
		let bestTrainSharpe = -Infinity;
		
		for (const p of [10, 20, 30, 40, 50]) {
			const resTrain = runBacktest(buildDonchianStrategy(p), trainCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
			if (resTrain.totalTrades > 0 && resTrain.sharpeRatio > bestTrainSharpe) {
				bestTrainSharpe = resTrain.sharpeRatio;
				bestPeriod = p;
			}
		}

		const resTrainBest = runBacktest(buildDonchianStrategy(bestPeriod), trainCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
		const resTest = runBacktest(buildDonchianStrategy(bestPeriod), testCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);

		rWfoResults.push({
			windowName: win.name,
			trainPeriod: `${win.trainStart} / ${win.trainEnd}`,
			testPeriod: `${win.testStart} / ${win.testEnd}`,
			optPeriod: bestPeriod,
			trainReturn: resTrainBest.totalReturn,
			trainSharpe: resTrainBest.sharpeRatio,
			testReturn: resTest.totalReturn,
			testSharpe: resTest.sharpeRatio
		});
	}

	// ─── TEST 4: Semester Performance Consistency (6-Month intervals) ─────────
	const semesters = [
		{ label: "2022 H1", start: "2022-01-01", end: "2022-06-30" },
		{ label: "2022 H2", start: "2022-07-01", end: "2022-12-31" },
		{ label: "2023 H1", start: "2023-01-01", end: "2023-06-30" },
		{ label: "2023 H2", start: "2023-07-01", end: "2023-12-31" },
		{ label: "2024 H1", start: "2024-01-01", end: "2024-06-30" },
		{ label: "2024 H2", start: "2024-07-01", end: "2024-12-31" },
		{ label: "2025 H1", start: "2025-01-01", end: "2025-06-30" },
		{ label: "2025 H2", start: "2025-07-01", end: "2025-12-31" },
		{ label: "2026 H1", start: "2026-01-01", end: "2026-07-06" }
	];

	const ethSemesters = [];
	const nearSemesters = [];

	for (const sem of semesters) {
		const startTs = new Date(`${sem.start}T00:00:00Z`).getTime();
		const endTs = new Date(`${sem.end}T23:59:59Z`).getTime();

		const ethSemCandles = ethCandles.filter(c => c.openTime >= startTs && c.openTime <= endTs);
		const nearSemCandles = nearCandles.filter(c => c.openTime >= startTs && c.openTime <= endTs);

		const resEth = runBacktest(buildDonchianStrategy(50), ethSemCandles, platformConfig, ethRisk, 'ETHUSDT', rawDefaults);
		const resNear = runBacktest(buildDonchianStrategy(20), nearSemCandles, platformConfig, nearRisk, 'NEARUSDT', rawDefaults);

		ethSemesters.push({ label: sem.label, return: resEth.totalReturn, sharpe: resEth.sharpeRatio, trades: resEth.totalTrades });
		nearSemesters.push({ label: sem.label, return: resNear.totalReturn, sharpe: resNear.sharpeRatio, trades: resNear.totalTrades });
	}

	// Save all to JSON
	const outData = {
		ethAdv,
		nearAdv,
		ethStats: {
			observedSharpe: eth50.sharpeRatio,
			sortino: eth50.sortinoRatio,
			calmar: eth50.calmarRatio,
			profitFactor: eth50.profitFactor,
			expectancyUsdt: eth50.analytics?.expectancyUsdt,
			expectancyR: eth50.analytics?.expectancyR,
			sqn: eth50.analytics?.sqn,
			kelly: eth50.analytics?.kelly,
			ulcerIndex: eth50.analytics?.ulcerIndex,
			recoveryFactor: eth50.analytics?.recoveryFactor,
			mar: eth50.marRatio
		},
		nearStats: {
			observedSharpe: near20.sharpeRatio,
			sortino: near20.sortinoRatio,
			calmar: near20.calmarRatio,
			profitFactor: near20.profitFactor,
			expectancyUsdt: near20.analytics?.expectancyUsdt,
			expectancyR: near20.analytics?.expectancyR,
			sqn: near20.analytics?.sqn,
			kelly: near20.analytics?.kelly,
			ulcerIndex: near20.analytics?.ulcerIndex,
			recoveryFactor: near20.analytics?.recoveryFactor,
			mar: near20.marRatio
		},
		dsrResults: {
			eth: { skewness: ethMoments.skewness, kurtosis: ethMoments.kurtosis, expectedMaxSR: ethDsrObj.expectedMaxSharpe, probability: ethDsrObj.dsrProbability, nEff: ethDsrObj.nEff },
			near: { skewness: nearMoments.skewness, kurtosis: nearMoments.kurtosis, expectedMaxSR: nearDsrObj.expectedMaxSharpe, probability: nearDsrObj.dsrProbability, nEff: nearDsrObj.nEff }
		},
		rWfoResults,
		semesterResults: {
			eth: ethSemesters,
			near: nearSemesters
		}
	};

	const outPath = join(process.cwd(), 'results', 'rolling_wfo_dsr_validation.json');
	writeFileSync(outPath, JSON.stringify(outData, null, 2), 'utf-8');
	console.log(`\n[Validation Lab] Saved results to: ${outPath}`);
}

run().catch(console.error);
