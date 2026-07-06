// ============================================================================
// KRIPTOQUANT — Validation Lab (Sprint 37)
// ============================================================================
// Otomatik çoklu varlık, zaman dilimi ve ablasyon matrisi koşucusudur.
// Performans artışlarının şans eseri olup olmadığını Wilcoxon ve t-test ile ölçer.
// Holm-Bonferroni correction ile çoklu test sapmalarını düzeltir.
// ============================================================================

import { fetchAndStore } from '../data/fetcher.js';
import { runExecution } from '../execution/engine.js';
import { SimulatedBroker } from '../execution/simulated-broker.js';
import { createEmaCrossStrategy } from './strategies/ema-cross/index.js';
import type { Candle } from '../core/types.js';

export interface ValidationLabOptions {
	readonly coins: string[];
	readonly intervals: string[];
	readonly startDate?: string;
	readonly endDate?: string;
}

export interface ValidationResultRow {
	readonly configName: string;
	readonly totalTrades: number;
	readonly winRatePercent: number;
	readonly profitFactor: number;
	readonly sharpeRatio: number;
	readonly sortinoRatio: number;
	readonly calmarRatio: number;
	readonly marRatio: number;
	readonly longestDrawdownDays: number;
	readonly timeUnderWaterPercent: number;
	readonly avgRecoveryTimeDays: number;
	readonly medianRecoveryTimeDays: number;
	readonly totalReturnPercent: number;
	readonly maxDrawdownPercent: number;
	readonly pValueTTest: number;
	readonly pValueTTestAdjusted: number;
	readonly pValueWilcoxon: number;
	readonly pValueWilcoxonAdjusted: number;
	readonly cohensD: number;
	readonly ciLower: number;
	readonly ciUpper: number;
	readonly sqn: number;
	readonly payoffRatio: number;
	readonly kellyPercent: number;
	readonly isSignificant: boolean;
}

export interface ValidationLabReport {
	readonly totalBacktestsRun: number;
	readonly summaryTable: ValidationResultRow[];
	readonly assetBreakdowns: Record<string, ValidationResultRow[]>;
	readonly details: {
		readonly coin: string;
		readonly interval: string;
		readonly runs: Record<string, any>;
	}[];
}

/**
 * Paired Wilcoxon Signed-Rank Test (Non-parametric statistical significance test)
 * Handles zero differences using the Wilcox method (ignoring them and reducing sample size).
 * Handles ties using average ranking.
 */
export function calculateWilcoxonSignedRank(
	rawReturns: number[],
	filteredReturns: number[]
): { wStatistic: number; pValue: number; isSignificant: boolean } {
	const n = rawReturns.length;
	if (n < 5) {
		return { wStatistic: 0, pValue: 1.0, isSignificant: false };
	}

	const diffs = filteredReturns.map((r, i) => r - rawReturns[i]).filter(d => Math.abs(d) > 0.000001);
	const nr = diffs.length;
	if (nr < 4) {
		return { wStatistic: 0, pValue: 1.0, isSignificant: false };
	}

	// Sort absolute differences
	const absDiffs = diffs.map((d, i) => ({ val: d, absVal: Math.abs(d), originalIndex: i }));
	absDiffs.sort((a, b) => a.absVal - b.absVal);

	// Assign ranks (with tie correction)
	const ranks = new Array<number>(nr);
	let i = 0;
	while (i < nr) {
		let j = i;
		while (j < nr && absDiffs[j].absVal === absDiffs[i].absVal) {
			j++;
		}
		const avgRank = (i + 1 + j) / 2;
		for (let k = i; k < j; k++) {
			ranks[k] = avgRank;
		}
		i = j;
	}

	let wPlus = 0;
	let wMinus = 0;
	for (let k = 0; k < nr; k++) {
		if (absDiffs[k].val > 0) {
			wPlus += ranks[k];
		} else {
			wMinus += ranks[k];
		}
	}

	const wStatistic = Math.min(wPlus, wMinus);

	// Normal approximation if nr >= 10
	if (nr >= 10) {
		const mu = (nr * (nr + 1)) / 4;
		const sigma = Math.sqrt((nr * (nr + 1) * (2 * nr + 1)) / 24);
		const z = (wStatistic - mu) / sigma;
		
		const absZ = Math.abs(z);
		const a = 0.147;
		const xSq = (absZ / Math.sqrt(2)) ** 2;
		const num = 4 / Math.PI + a * xSq;
		const den = 1 + a * xSq;
		const erf = Math.sqrt(1 - Math.exp(-xSq * (num / den)));
		const cdf = 0.5 * (1 + erf);
		
		const pValue = 2 * (1 - cdf);
		return {
			wStatistic,
			pValue: Math.min(1.0, Math.max(0.0, pValue)),
			isSignificant: pValue < 0.05 && wPlus > wMinus
		};
	} else {
		let isSignificant = false;
		if (nr === 5 && wStatistic === 0) isSignificant = true;
		else if (nr === 6 && wStatistic <= 2) isSignificant = true;
		else if (nr === 7 && wStatistic <= 2) isSignificant = true;
		else if (nr === 8 && wStatistic <= 4) isSignificant = true;
		else if (nr === 9 && wStatistic <= 6) isSignificant = true;
		
		return {
			wStatistic,
			pValue: isSignificant ? 0.049 : 0.5,
			isSignificant: isSignificant && wPlus > wMinus
		};
	}
}

/**
 * İki eşleştirilmiş getiri serisi üzerinde t-testi, Cohen's dz ve Confidence Interval hesaplar.
 */
export function calculatePairedTTest(
	rawReturns: number[],
	filteredReturns: number[]
): { 
	tStatistic: number; 
	pValue: number; 
	isSignificant: boolean;
	meanDiff: number;
	cohensD: number;
	ciLower: number;
	ciUpper: number;
} {
	const n = rawReturns.length;
	if (n < 2) {
		return { tStatistic: 0, pValue: 1.0, isSignificant: false, meanDiff: 0, cohensD: 0, ciLower: 0, ciUpper: 0 };
	}

	const differences = filteredReturns.map((r, i) => r - r); // Wait, this was a bug! filteredReturns[i] - rawReturns[i] is what we want!
	const actualDiffs = filteredReturns.map((r, i) => r - rawReturns[i]);
	const meanDiff = actualDiffs.reduce((sum, d) => sum + d, 0) / n;

	const sumSqDiff = actualDiffs.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0);
	const varianceDiff = sumSqDiff / (n - 1);
	const stdDevDiff = Math.sqrt(varianceDiff);

	if (stdDevDiff === 0) {
		return { tStatistic: 0, pValue: 1.0, isSignificant: false, meanDiff, cohensD: 0, ciLower: meanDiff, ciUpper: meanDiff };
	}

	const stdError = stdDevDiff / Math.sqrt(n);
	const tStatistic = meanDiff / stdError;

	// Student's t critical values approximation (two-tailed, alpha = 0.05)
	const df = n - 1;
	let tCritical = 1.96; // Normal dağılım yaklaşımı (büyük örneklem)
	if (df === 1) tCritical = 12.706;
	else if (df === 2) tCritical = 4.303;
	else if (df === 3) tCritical = 3.182;
	else if (df === 4) tCritical = 2.776;
	else if (df === 5) tCritical = 2.571;
	else if (df === 6) tCritical = 2.447;
	else if (df === 7) tCritical = 2.365;
	else if (df === 8) tCritical = 2.306;
	else if (df === 9) tCritical = 2.262;
	else if (df === 10) tCritical = 2.228;
	else if (df <= 15) tCritical = 2.131;
	else if (df <= 20) tCritical = 2.086;
	else if (df <= 30) tCritical = 2.042;
	else if (df <= 60) tCritical = 2.000;

	// Margin of Error and Confidence Intervals of difference
	const marginOfError = tCritical * stdError;
	const ciLower = meanDiff - marginOfError;
	const ciUpper = meanDiff + marginOfError;

	// Cohen's dz (paired difference standard dev divisor)
	const cohensD = meanDiff / stdDevDiff;

	// p-değeri yaklaşımı (t-statistic değerine göre)
	const absT = Math.abs(tStatistic);
	let pValue = 1.0;
	if (absT >= tCritical) {
		pValue = 0.05 * (tCritical / absT);
	} else {
		pValue = 0.05 + 0.95 * (1 - absT / tCritical);
	}
	if (pValue > 1.0) pValue = 1.0;

	return {
		tStatistic,
		pValue,
		isSignificant: absT >= tCritical && meanDiff > 0,
		meanDiff,
		cohensD,
		ciLower,
		ciUpper
	};
}

/**
 * Holm-Bonferroni p-value correction for multiple comparisons.
 * Controls the family-wise error rate (FWER) across multiple tests.
 */
export function adjustPValuesHolm(pValues: number[]): number[] {
	const n = pValues.length;
	if (n === 0) return [];

	const indexed = pValues.map((p, idx) => ({ p, idx, adjusted: p }));
	indexed.sort((a, b) => a.p - b.p);

	let maxVal = 0;
	for (let i = 0; i < n; i++) {
		const multiplier = n - i;
		const candidate = indexed[i].p * multiplier;
		maxVal = Math.max(maxVal, candidate);
		indexed[i].adjusted = Math.min(1.0, maxVal);
	}

	const results = new Array<number>(n);
	for (const item of indexed) {
		results[item.idx] = item.adjusted;
	}

	return results;
}

/**
 * Helper to calculate expectancy, SQN, Payoff, and Kelly from trade PnL arrays.
 */
export function calculateTradeStats(tradePnls: number[], winsCount: number): { sqn: number; payoffRatio: number; kellyPercent: number } {
	const N = tradePnls.length;
	if (N === 0) {
		return { sqn: 0, payoffRatio: 0, kellyPercent: 0 };
	}

	const winRate = winsCount / N;

	const wins = tradePnls.filter(p => p > 0);
	const losses = tradePnls.filter(p => p < 0);
	
	const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
	const avgLoss = losses.length > 0 ? losses.reduce((s, v) => s + v, 0) / losses.length : 0;
	const payoffRatio = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;

	const kellyValue = payoffRatio > 0 ? winRate - (1 - winRate) / payoffRatio : 0;
	const kellyPercent = kellyValue > 0 ? kellyValue * 100 : 0;

	const mean = tradePnls.reduce((s, v) => s + v, 0) / N;
	const sumSq = tradePnls.reduce((s, v) => s + (v - mean) ** 2, 0);
	const stdDev = N > 1 ? Math.sqrt(sumSq / (N - 1)) : 0;
	const sqn = stdDev > 0 ? (mean / stdDev) * Math.sqrt(N) : 0;

	return {
		sqn,
		payoffRatio,
		kellyPercent
	};
}

/**
 * Equity eğrisini 90 günlük alt dönemlere (kuşaklara) bölerek getiri serisi üretir.
 */
function getPeriodReturns(equityCurve: ReadonlyArray<any>, periodDays: number = 90): number[] {
	if (equityCurve.length < 2) return [];

	const returns: number[] = [];
	const msInDay = 24 * 60 * 60 * 1000;
	const periodMs = periodDays * msInDay;

	let lastAnchorEquity = equityCurve[0].equity;
	let lastAnchorTime = equityCurve[0].timestamp;

	for (let i = 1; i < equityCurve.length; i++) {
		const pt = equityCurve[i];
		if (pt.timestamp - lastAnchorTime >= periodMs) {
			const ret = (pt.equity - lastAnchorEquity) / lastAnchorEquity;
			returns.push(ret);
			lastAnchorEquity = pt.equity;
			lastAnchorTime = pt.timestamp;
		}
	}

	// Kalan son kısmı ekle
	const lastPt = equityCurve[equityCurve.length - 1];
	if (lastPt.timestamp > lastAnchorTime) {
		const ret = (lastPt.equity - lastAnchorEquity) / lastAnchorEquity;
		returns.push(ret);
	}

	return returns;
}

export async function runValidationLab(options: ValidationLabOptions): Promise<ValidationLabReport> {
	const { coins, intervals, startDate, endDate } = options;
	const startTime = startDate ? new Date(startDate).getTime() : undefined;
	const endTime = endDate ? new Date(endDate).getTime() : undefined;

	const platformConfig = {
		initialCapital: 10000,
		commissionPercent: 0.1,
		slippagePercent: 0.05,
		makerFee: 0.0002,
		takerFee: 0.0004,
		slippageModel: 'linear' as const
	};

	const riskConfig = {
		maxPositionPercent: 20,
		maxDailyLossPercent: 5,
		maxOrderValue: 2000,
		stopLossAtrMultiplier: 2,
		stopLossPercent: 0.05,
		takeProfitPercent: 0.15
	};

	const strategy = createEmaCrossStrategy(9, 21);
	const broker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);

	const configurations = [
		{
			name: 'Raw Strategy',
			filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
			confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
		},
		{
			name: 'Strategy + ADX',
			filters: { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 0 },
			confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
		},
		{
			name: 'Strategy + RVOL',
			filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 1.5 },
			confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
		},
		{
			name: 'Strategy + BOTH (ADX & RVOL)',
			filters: { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 },
			confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
		}
	];

	const details: any[] = [];
	
	// Global returns accumulator
	const configQuarterlyReturns: Record<string, number[]> = {
		'Raw Strategy': [],
		'Strategy + ADX': [],
		'Strategy + RVOL': [],
		'Strategy + BOTH (ADX & RVOL)': []
	};

	// Global metrics accumulator
	const configAggregates: Record<string, {
		trades: number;
		wins: number;
		pnlSum: number;
		ddSum: number;
		sharpeSum: number;
		sortinoSum: number;
		calmarSum: number;
		marSum: number;
		longestDdMax: number;
		timeUnderWaterSum: number;
		avgRecoverySum: number;
		medianRecoverySum: number;
		pfSum: number;
		allTradePnls: number[];
	}> = {};

	// Asset-by-asset aggregates tracker
	const assetAggregates: Record<string, Record<string, {
		trades: number;
		wins: number;
		pnlSum: number;
		ddSum: number;
		sharpeSum: number;
		sortinoSum: number;
		calmarSum: number;
		marSum: number;
		longestDdMax: number;
		timeUnderWaterSum: number;
		avgRecoverySum: number;
		medianRecoverySum: number;
		pfSum: number;
		runCount: number;
		quarterlyReturns: number[];
		allTradePnls: number[];
	}>> = {};

	for (const config of configurations) {
		configAggregates[config.name] = {
			trades: 0, wins: 0, pnlSum: 0, ddSum: 0, sharpeSum: 0,
			sortinoSum: 0, calmarSum: 0, marSum: 0, longestDdMax: 0,
			timeUnderWaterSum: 0, avgRecoverySum: 0, medianRecoverySum: 0, pfSum: 0,
			allTradePnls: []
		};
	}

	let totalRuns = 0;

	for (const coin of coins) {
		assetAggregates[coin] = {};
		for (const config of configurations) {
			assetAggregates[coin][config.name] = {
				trades: 0, wins: 0, pnlSum: 0, ddSum: 0, sharpeSum: 0,
				sortinoSum: 0, calmarSum: 0, marSum: 0, longestDdMax: 0,
				timeUnderWaterSum: 0, avgRecoverySum: 0, medianRecoverySum: 0, pfSum: 0,
				runCount: 0, quarterlyReturns: [], allTradePnls: []
			};
		}

		for (const interval of intervals) {
			const candles = await fetchAndStore(coin, interval, { startTime, endTime });
			if (candles.length < 50) continue;

			totalRuns++;
			const coinRunDetail: Record<string, any> = {};

			for (const config of configurations) {
				const res = runExecution(candles, strategy, broker, platformConfig, riskConfig, coin, config);
				coinRunDetail[config.name] = {
					trades: res.totalTrades,
					winRate: res.winRate,
					profitFactor: res.profitFactor,
					sharpe: res.sharpeRatio,
					totalReturn: res.totalReturn,
					maxDrawdown: res.maxDrawdown
				};

				// Global aggregation
				const agg = configAggregates[config.name];
				agg.trades += res.totalTrades;
				agg.wins += res.winningTrades;
				agg.pnlSum += res.totalReturn;
				agg.ddSum += res.maxDrawdown;
				agg.sharpeSum += res.sharpeRatio;
				agg.sortinoSum += res.sortinoRatio;
				agg.calmarSum += res.calmarRatio;
				agg.marSum += res.marRatio;
				if (res.longestDrawdownDays > agg.longestDdMax) {
					agg.longestDdMax = res.longestDrawdownDays;
				}
				agg.timeUnderWaterSum += res.timeUnderWaterPercent;
				agg.avgRecoverySum += res.avgRecoveryTimeDays;
				agg.medianRecoverySum += res.medianRecoveryTimeDays;
				agg.pfSum += res.profitFactor === Infinity ? 5.0 : res.profitFactor;
				agg.allTradePnls.push(...res.trades.map(t => t.pnlPercent));

				// Asset aggregation
				const aAgg = assetAggregates[coin][config.name];
				aAgg.trades += res.totalTrades;
				aAgg.wins += res.winningTrades;
				aAgg.pnlSum += res.totalReturn;
				aAgg.ddSum += res.maxDrawdown;
				aAgg.sharpeSum += res.sharpeRatio;
				aAgg.sortinoSum += res.sortinoRatio;
				aAgg.calmarSum += res.calmarRatio;
				aAgg.marSum += res.marRatio;
				if (res.longestDrawdownDays > aAgg.longestDdMax) {
					aAgg.longestDdMax = res.longestDrawdownDays;
				}
				aAgg.timeUnderWaterSum += res.timeUnderWaterPercent;
				aAgg.avgRecoverySum += res.avgRecoveryTimeDays;
				aAgg.medianRecoverySum += res.medianRecoveryTimeDays;
				aAgg.pfSum += res.profitFactor === Infinity ? 5.0 : res.profitFactor;
				aAgg.runCount++;
				aAgg.allTradePnls.push(...res.trades.map(t => t.pnlPercent));

				const qRet = getPeriodReturns(res.equityCurve, 90);
				configQuarterlyReturns[config.name].push(...qRet);
				aAgg.quarterlyReturns.push(...qRet);
			}

			details.push({
				coin,
				interval,
				runs: coinRunDetail
			});
		}
	}

	// Calculate overall tables
	const rawReturns = configQuarterlyReturns['Raw Strategy'];
	const summaryTable: ValidationResultRow[] = [];

	for (const config of configurations) {
		const agg = configAggregates[config.name];
		const returns = configQuarterlyReturns[config.name];

		let pValueT = 1.0;
		let pValueW = 1.0;
		let cohensD = 0;
		let ciLower = 0;
		let ciUpper = 0;
		let isSignificant = false;

		if (config.name !== 'Raw Strategy') {
			const tRes = calculatePairedTTest(rawReturns, returns);
			pValueT = tRes.pValue;
			cohensD = tRes.cohensD;
			ciLower = tRes.ciLower;
			ciUpper = tRes.ciUpper;

			const wRes = calculateWilcoxonSignedRank(rawReturns, returns);
			pValueW = wRes.pValue;
			isSignificant = wRes.isSignificant && tRes.meanDiff > 0;
		}

		// Calculate trade statistics
		const tStats = calculateTradeStats(agg.allTradePnls, agg.wins);

		summaryTable.push({
			configName: config.name,
			totalTrades: agg.trades,
			winRatePercent: agg.trades > 0 ? (agg.wins / agg.trades) * 100 : 0,
			profitFactor: totalRuns > 0 ? agg.pfSum / totalRuns : 0,
			sharpeRatio: totalRuns > 0 ? agg.sharpeSum / totalRuns : 0,
			sortinoRatio: totalRuns > 0 ? agg.sortinoSum / totalRuns : 0,
			calmarRatio: totalRuns > 0 ? agg.calmarSum / totalRuns : 0,
			marRatio: totalRuns > 0 ? agg.marSum / totalRuns : 0,
			longestDrawdownDays: agg.longestDdMax,
			timeUnderWaterPercent: totalRuns > 0 ? agg.timeUnderWaterSum / totalRuns : 0,
			avgRecoveryTimeDays: totalRuns > 0 ? agg.avgRecoverySum / totalRuns : 0,
			medianRecoveryTimeDays: totalRuns > 0 ? agg.medianRecoverySum / totalRuns : 0,
			totalReturnPercent: totalRuns > 0 ? agg.pnlSum / totalRuns : 0,
			maxDrawdownPercent: totalRuns > 0 ? agg.ddSum / totalRuns : 0,
			pValueTTest: pValueT,
			pValueTTestAdjusted: pValueT, // filled below by Holm
			pValueWilcoxon: pValueW,
			pValueWilcoxonAdjusted: pValueW, // filled below by Holm
			cohensD,
			ciLower,
			ciUpper,
			sqn: tStats.sqn,
			payoffRatio: tStats.payoffRatio,
			kellyPercent: tStats.kellyPercent,
			isSignificant
		});
	}

	// Apply Holm-Bonferroni correction globally
	const tPValues = summaryTable.filter(r => r.configName !== 'Raw Strategy').map(r => r.pValueTTest);
	const wPValues = summaryTable.filter(r => r.configName !== 'Raw Strategy').map(r => r.pValueWilcoxon);
	const adjustedTPValues = adjustPValuesHolm(tPValues);
	const adjustedWPValues = adjustPValuesHolm(wPValues);

	let adjIdx = 0;
	for (const row of summaryTable) {
		if (row.configName === 'Raw Strategy') {
			(row as any).pValueTTestAdjusted = 1.0;
			(row as any).pValueWilcoxonAdjusted = 1.0;
		} else {
			(row as any).pValueTTestAdjusted = adjustedTPValues[adjIdx];
			(row as any).pValueWilcoxonAdjusted = adjustedWPValues[adjIdx];
			(row as any).isSignificant = adjustedTPValues[adjIdx] < 0.05 || adjustedWPValues[adjIdx] < 0.05;
			adjIdx++;
		}
	}

	// Calculate asset breakthroughs
	const assetBreakdowns: Record<string, ValidationResultRow[]> = {};
	for (const coin of coins) {
		const rows: ValidationResultRow[] = [];
		const rawAssetReturns = assetAggregates[coin]['Raw Strategy'].quarterlyReturns;

		for (const config of configurations) {
			const aAgg = assetAggregates[coin][config.name];
			const returns = aAgg.quarterlyReturns;

			let pValueT = 1.0;
			let pValueW = 1.0;
			let cohensD = 0;
			let ciLower = 0;
			let ciUpper = 0;
			let isSignificant = false;

			if (config.name !== 'Raw Strategy') {
				const tRes = calculatePairedTTest(rawAssetReturns, returns);
				pValueT = tRes.pValue;
				cohensD = tRes.cohensD;
				ciLower = tRes.ciLower;
				ciUpper = tRes.ciUpper;

				const wRes = calculateWilcoxonSignedRank(rawAssetReturns, returns);
				pValueW = wRes.pValue;
				isSignificant = wRes.isSignificant && tRes.meanDiff > 0;
			}

			const tStats = calculateTradeStats(aAgg.allTradePnls, aAgg.wins);

			rows.push({
				configName: config.name,
				totalTrades: aAgg.trades,
				winRatePercent: aAgg.trades > 0 ? (aAgg.wins / aAgg.trades) * 100 : 0,
				profitFactor: aAgg.runCount > 0 ? aAgg.pfSum / aAgg.runCount : 0,
				sharpeRatio: aAgg.runCount > 0 ? aAgg.sharpeSum / aAgg.runCount : 0,
				sortinoRatio: aAgg.runCount > 0 ? aAgg.sortinoSum / aAgg.runCount : 0,
				calmarRatio: aAgg.runCount > 0 ? aAgg.calmarSum / aAgg.runCount : 0,
				marRatio: aAgg.runCount > 0 ? aAgg.marSum / aAgg.runCount : 0,
				longestDrawdownDays: aAgg.longestDdMax,
				timeUnderWaterPercent: aAgg.runCount > 0 ? aAgg.timeUnderWaterSum / aAgg.runCount : 0,
				avgRecoveryTimeDays: aAgg.runCount > 0 ? aAgg.avgRecoverySum / aAgg.runCount : 0,
				medianRecoveryTimeDays: aAgg.runCount > 0 ? aAgg.medianRecoverySum / aAgg.runCount : 0,
				totalReturnPercent: aAgg.runCount > 0 ? aAgg.pnlSum / aAgg.runCount : 0,
				maxDrawdownPercent: aAgg.runCount > 0 ? aAgg.ddSum / aAgg.runCount : 0,
				pValueTTest: pValueT,
				pValueTTestAdjusted: pValueT, // filled below
				pValueWilcoxon: pValueW,
				pValueWilcoxonAdjusted: pValueW, // filled below
				cohensD,
				ciLower,
				ciUpper,
				sqn: tStats.sqn,
				payoffRatio: tStats.payoffRatio,
				kellyPercent: tStats.kellyPercent,
				isSignificant
			});
		}

		// Apply Holm-Bonferroni correction per asset
		const assetTPValues = rows.filter(r => r.configName !== 'Raw Strategy').map(r => r.pValueTTest);
		const assetWPValues = rows.filter(r => r.configName !== 'Raw Strategy').map(r => r.pValueWilcoxon);
		const adjAssetTPValues = adjustPValuesHolm(assetTPValues);
		const adjAssetWPValues = adjustPValuesHolm(assetWPValues);

		let adjAIdx = 0;
		for (const row of rows) {
			if (row.configName === 'Raw Strategy') {
				(row as any).pValueTTestAdjusted = 1.0;
				(row as any).pValueWilcoxonAdjusted = 1.0;
			} else {
				(row as any).pValueTTestAdjusted = adjAssetTPValues[adjAIdx];
				(row as any).pValueWilcoxonAdjusted = adjAssetWPValues[adjAIdx];
				(row as any).isSignificant = adjAssetTPValues[adjAIdx] < 0.05 || adjAssetWPValues[adjAIdx] < 0.05;
				adjAIdx++;
			}
		}

		assetBreakdowns[coin] = rows;
	}

	return {
		totalBacktestsRun: totalRuns * 4,
		summaryTable,
		assetBreakdowns,
		details
	};
}
