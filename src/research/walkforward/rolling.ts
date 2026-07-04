// ============================================================================
// KRIPTOQUANT — Rolling Walk-Forward & Robustness Lab (Sprint 10)
// ============================================================================
// Stratejinin farklı piyasa rejimlerinde tutarlılığını ölçer.
// Kayan pencereler: Her pencere bağımsız train/test. Gelecek sızmaz.
// Mevcut walkforward motorunu yeniden kullanır (DRY).
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import type { Candle, PlatformConfig, RiskConfig } from '../../core/types.js';
import { formatDate } from '../../core/utils.js';
import type { TimePeriod } from './data-splitter.js';
import {
	filterSweepByStrategy,
	scoreGeneralization,
	extractMetrics,
	type WalkForwardMetrics,
	type GeneralizationScore,
} from './walkforward.js';
import {
	generateCombinations,
	runExperiment,
	DEFAULT_SWEEP,
	type ExperimentParams,
	type SweepConfig,
} from '../experiments/runner.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface WindowSpec {
	readonly windowIndex: number;
	readonly trainStart: number;
	readonly trainEnd: number;
	readonly testStart: number;
	readonly testEnd: number;
}

export interface WindowResult {
	readonly windowIndex: number;
	readonly bestParams: ExperimentParams;
	readonly trainMetrics: WalkForwardMetrics;
	readonly testMetrics: WalkForwardMetrics;
	readonly generalization: GeneralizationScore;
	readonly trainPeriod: TimePeriod;
	readonly testPeriod: TimePeriod;
	readonly passed: boolean;
}

export interface RobustnessScore {
	readonly score: number;       // 0-100
	readonly passRate: number;    // 0-1
	readonly avgTestReturn: number;
	readonly avgAlpha: number;
	readonly avgSharpe: number;
	readonly avgMaxDrawdown: number;
	readonly returnStdDev: number;
	readonly sharpeStdDev: number;
	readonly label: string;
}

export interface RollingResult {
	readonly windows: WindowResult[];
	readonly robustness: RobustnessScore;
	readonly strategyName: string;
	readonly coin: string;
	readonly interval: string;
	readonly numWindows: number;
	readonly trainRatio: number;
	readonly durationMs: number;
	readonly gitCommit: string;
	readonly timestamp: string;
}

// ─── Rolling Window Generator ────────────────────────────────────────────────

/**
 * Kayan pencereler oluşturur. Her pencere eşit trainSize ve testSize'a sahiptir.
 * Test bölgeleri overlap etmez. Train bölgeleri overlap edebilir.
 * Gelecek geçmişe sızmaz.
 *
 * Formül:
 *   trainSize = totalCandles / (1 + numWindows × (1 - trainRatio) / trainRatio)
 *   testSize  = trainSize × (1 - trainRatio) / trainRatio
 *   step      = testSize  (her pencere testSize kadar ilerler)
 */
export function generateRollingWindows(
	totalCandles: number,
	numWindows: number,
	trainRatio: number = 0.70,
): WindowSpec[] {
	if (totalCandles < 20) throw new Error(`Veri çok kısa: ${totalCandles} mum`);
	if (numWindows < 2) throw new Error('En az 2 pencere gerekli');
	if (trainRatio <= 0 || trainRatio >= 1) throw new Error(`trainRatio 0-1 arası olmalı: ${trainRatio}`);

	const trainSize = Math.floor(totalCandles / (1 + numWindows * (1 - trainRatio) / trainRatio));
	const testSize = Math.floor(trainSize * (1 - trainRatio) / trainRatio);
	const step = testSize;

	if (trainSize < 10) throw new Error('Train penceresi çok küçük, daha az pencere deneyin');
	if (testSize < 5) throw new Error('Test penceresi çok küçük, daha az pencere deneyin');

	const windows: WindowSpec[] = [];

	for (let i = 0; i < numWindows; i++) {
		const trainStart = i * step;
		const trainEnd = trainStart + trainSize;
		const testStart = trainEnd;
		const testEnd = Math.min(testStart + testSize, totalCandles);

		if (testEnd > totalCandles) break;

		windows.push({
			windowIndex: i + 1,
			trainStart,
			trainEnd,
			testStart,
			testEnd,
		});
	}

	return windows;
}

// ─── Standart Sapma ──────────────────────────────────────────────────────────

function stddev(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

// ─── Robustness Score ────────────────────────────────────────────────────────

/**
 * Robustness Score hesaplama (0-100 arası).
 *
 * Formül:
 *   passRate        = PASS sayısı / toplam pencere        (0-1)
 *   sharpeStability = 1 / (1 + stddev(test sharpes))      (0-1, düşük varyans → yüksek)
 *   returnStability = 1 / (1 + stddev(test returns))      (0-1, düşük varyans → yüksek)
 *   drawdownPenalty = 1 / (1 + avgMaxDrawdown / 10)       (0-1, %10 DD → 0.5 ceza)
 *
 *   rawScore = (passRate × 50 + sharpeStability × 25 + returnStability × 25) × drawdownPenalty
 *   score    = clamp(0, 100, round(rawScore))
 */
export function calculateRobustness(windows: WindowResult[]): RobustnessScore {
	const testReturns = windows.map((w) => w.testMetrics.totalReturn);
	const testSharpes = windows.map((w) => w.testMetrics.sharpeRatio);
	const testDrawdowns = windows.map((w) => w.testMetrics.maxDrawdown);
	const testAlphas = windows.map((w) => w.testMetrics.alpha);

	const passCount = windows.filter((w) => w.passed).length;
	const passRate = passCount / windows.length;

	const avgTestReturn = testReturns.reduce((a, b) => a + b, 0) / testReturns.length;
	const avgSharpe = testSharpes.reduce((a, b) => a + b, 0) / testSharpes.length;
	const avgMaxDrawdown = testDrawdowns.reduce((a, b) => a + b, 0) / testDrawdowns.length;
	const avgAlpha = testAlphas.reduce((a, b) => a + b, 0) / testAlphas.length;

	const returnStdDev = stddev(testReturns);
	const sharpeStdDev = stddev(testSharpes);

	const sharpeStability = 1 / (1 + sharpeStdDev);
	const returnStability = 1 / (1 + returnStdDev);
	const drawdownPenalty = 1 / (1 + avgMaxDrawdown / 10);

	const rawScore = (passRate * 50 + sharpeStability * 25 + returnStability * 25) * drawdownPenalty;
	const score = Math.round(Math.min(100, Math.max(0, rawScore)));

	let label: string;
	if (score >= 70) label = '🟢 ROBUST';
	else if (score >= 50) label = '🟡 MODERATE';
	else if (score >= 30) label = '🟠 FRAGILE';
	else label = '🔴 UNRELIABLE';

	return {
		score,
		passRate: Math.round(passRate * 100) / 100,
		avgTestReturn: Math.round(avgTestReturn * 100) / 100,
		avgAlpha: Math.round(avgAlpha * 100) / 100,
		avgSharpe: Math.round(avgSharpe * 1000) / 1000,
		avgMaxDrawdown: Math.round(avgMaxDrawdown * 100) / 100,
		returnStdDev: Math.round(returnStdDev * 100) / 100,
		sharpeStdDev: Math.round(sharpeStdDev * 1000) / 1000,
		label,
	};
}

// ─── Git Commit ──────────────────────────────────────────────────────────────

function getGitCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
}

// ─── Rolling Walk-Forward Engine ─────────────────────────────────────────────

/**
 * Rolling Walk-Forward Validation.
 * N bağımsız pencerede ayrı ayrı train → sweep → test → score yapar.
 * Her pencere mevcut WF altyapısını kullanır (DRY).
 */
export function runRollingWalkForward(
	candles: Candle[],
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string,
	interval: string,
	strategyName?: string,
	numWindows: number = 5,
	trainRatio: number = 0.70,
): RollingResult {
	const startTime = Date.now();

	console.log('');
	console.log('  🔬 Rolling Walk-Forward Validation başlıyor...');
	console.log(`  📊 Toplam: ${candles.length} mum | Pencere: ${numWindows} | Train: ${Math.round(trainRatio * 100)}%`);

	const windowSpecs = generateRollingWindows(candles.length, numWindows, trainRatio);
	const sweepConfig = filterSweepByStrategy(DEFAULT_SWEEP, strategyName);
	const combinations = generateCombinations(sweepConfig);

	console.log(`  ⚗️  Kombinasyon/pencere: ${combinations.length}`);
	console.log('');

	const windowResults: WindowResult[] = [];

	for (const spec of windowSpecs) {
		const trainCandles = candles.slice(spec.trainStart, spec.trainEnd);
		const testCandles = candles.slice(spec.testStart, spec.testEnd);

		const trainPeriod: TimePeriod = {
			start: formatDate(trainCandles[0].openTime),
			end: formatDate(trainCandles[trainCandles.length - 1].openTime),
			startTs: trainCandles[0].openTime,
			endTs: trainCandles[trainCandles.length - 1].openTime,
			candleCount: trainCandles.length,
		};

		const testPeriod: TimePeriod = {
			start: formatDate(testCandles[0].openTime),
			end: formatDate(testCandles[testCandles.length - 1].openTime),
			startTs: testCandles[0].openTime,
			endTs: testCandles[testCandles.length - 1].openTime,
			candleCount: testCandles.length,
		};

		// Train sweep
		const trainResults = combinations.map((params) =>
			runExperiment(trainCandles, params, platformConfig, riskConfig, coin),
		);

		const withTrades = trainResults.filter((r) => r.totalTrades > 0);

		if (withTrades.length === 0) {
			const noEdge: WalkForwardMetrics = {
				totalReturn: 0, sharpeRatio: 0, profitFactor: 0, maxDrawdown: 0,
				totalTrades: 0, winRate: 0, alpha: 0, totalSignals: 0, acceptedSignals: 0,
			};
			windowResults.push({
				windowIndex: spec.windowIndex,
				bestParams: combinations[0],
				trainMetrics: noEdge,
				testMetrics: noEdge,
				generalization: { retention: 0, label: 'NO EDGE', emoji: '⚠️' },
				trainPeriod,
				testPeriod,
				passed: false,
			});
			process.stdout.write(`  Window ${spec.windowIndex}/${windowSpecs.length}: ⚠️  NO EDGE\n`);
			continue;
		}

		// En iyi parametre (Sharpe)
		const best = withTrades.sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];

		// Test
		const testResult = runExperiment(testCandles, best.params, platformConfig, riskConfig, coin);
		const generalization = scoreGeneralization(best.totalReturn, testResult.totalReturn);

		const passed = testResult.totalReturn > 0 && generalization.label !== 'FAILED';

		windowResults.push({
			windowIndex: spec.windowIndex,
			bestParams: best.params,
			trainMetrics: extractMetrics(best),
			testMetrics: extractMetrics(testResult),
			generalization,
			trainPeriod,
			testPeriod,
			passed,
		});

		const icon = passed ? '✅' : '❌';
		const trainRet = best.totalReturn > 0 ? `+${best.totalReturn}` : `${best.totalReturn}`;
		const testRet = testResult.totalReturn > 0 ? `+${testResult.totalReturn}` : `${testResult.totalReturn}`;
		process.stdout.write(`  Window ${spec.windowIndex}/${windowSpecs.length}: ${icon} Train ${trainRet}% → Test ${testRet}%\n`);
	}

	const robustness = calculateRobustness(windowResults);

	return {
		windows: windowResults,
		robustness,
		strategyName: strategyName ?? 'all',
		coin,
		interval,
		numWindows: windowSpecs.length,
		trainRatio,
		durationMs: Date.now() - startTime,
		gitCommit: getGitCommit(),
		timestamp: new Date().toISOString(),
	};
}

// ─── Stability Report ────────────────────────────────────────────────────────

function formatParamLabel(p: ExperimentParams): string {
	if (p.emaFast != null) return `EMA ${p.emaFast}/${p.emaSlow}`;
	if (p.donchianPeriod != null) return `DC ${p.donchianPeriod}`;
	return p.strategyName;
}

export function printRollingReport(result: RollingResult): void {
	const divider = '═'.repeat(64);
	const thinDivider = '─'.repeat(64);
	const rob = result.robustness;

	console.log('');
	console.log(divider);
	console.log('  🔬 ROLLING WALK-FORWARD — Stability Report');
	console.log(divider);

	// Her pencere
	for (const w of result.windows) {
		const icon = w.passed ? '✅' : '❌';
		const trainRet = w.trainMetrics.totalReturn > 0 ? `+${w.trainMetrics.totalReturn}` : `${w.trainMetrics.totalReturn}`;
		const testRet = w.testMetrics.totalReturn > 0 ? `+${w.testMetrics.totalReturn}` : `${w.testMetrics.totalReturn}`;

		console.log('');
		console.log(thinDivider);
		console.log(`  Window ${w.windowIndex}  ${icon}  [${formatParamLabel(w.bestParams)}]`);
		console.log(thinDivider);
		console.log(`  Train  : ${w.trainPeriod.start} → ${w.trainPeriod.end} (${w.trainPeriod.candleCount} mum)`);
		console.log(`  Test   : ${w.testPeriod.start} → ${w.testPeriod.end} (${w.testPeriod.candleCount} mum)`);
		console.log(`  Train  : ${trainRet}% | Sharpe: ${w.trainMetrics.sharpeRatio} | PF: ${w.trainMetrics.profitFactor}`);
		console.log(`  Test   : ${testRet}% | Sharpe: ${w.testMetrics.sharpeRatio} | PF: ${w.testMetrics.profitFactor}`);
		console.log(`  Verdict: ${w.generalization.emoji} ${w.generalization.label}`);
	}

	// Özet
	console.log('');
	console.log(divider);
	console.log('  🎯 ROBUSTNESS SUMMARY');
	console.log(divider);
	console.log('');

	const passCount = result.windows.filter((w) => w.passed).length;
	const failCount = result.windows.length - passCount;

	console.log(`  PASS Rate       : ${passCount}/${result.windows.length} (${Math.round(rob.passRate * 100)}%)`);
	console.log(`  Avg Test Return : ${rob.avgTestReturn > 0 ? '+' : ''}${rob.avgTestReturn}%`);
	console.log(`  Avg Alpha       : ${rob.avgAlpha > 0 ? '+' : ''}${rob.avgAlpha}%`);
	console.log(`  Avg Sharpe      : ${rob.avgSharpe}`);
	console.log(`  Avg Max DD      : -${rob.avgMaxDrawdown}%`);
	console.log(`  Return Std Dev  : ${rob.returnStdDev}`);
	console.log(`  Sharpe Std Dev  : ${rob.sharpeStdDev}`);
	console.log('');
	console.log(`  ╔══════════════════════════════════════╗`);
	console.log(`  ║  ROBUSTNESS SCORE: ${String(rob.score).padStart(3)} / 100  ${rob.label.padEnd(12)}║`);
	console.log(`  ╚══════════════════════════════════════╝`);
	console.log('');
	console.log(`  Strategy  : ${result.strategyName}`);
	console.log(`  Coin      : ${result.coin}`);
	console.log(`  Interval  : ${result.interval}`);
	console.log(`  Windows   : ${result.numWindows}`);
	console.log(`  Git Commit: ${result.gitCommit}`);
	console.log(`  Duration  : ${result.durationMs}ms`);
	console.log('');
	console.log(divider);
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

export function exportRollingCSV(result: RollingResult, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const header = [
		'Window', 'Strategy', 'Params',
		'TrainStart', 'TrainEnd', 'TestStart', 'TestEnd',
		'TrainReturn', 'TestReturn', 'Alpha', 'Sharpe', 'Drawdown', 'Verdict',
	].join(',');

	const rows = result.windows.map((w) => [
		w.windowIndex,
		w.bestParams.strategyName,
		formatParamLabel(w.bestParams),
		w.trainPeriod.start,
		w.trainPeriod.end,
		w.testPeriod.start,
		w.testPeriod.end,
		w.trainMetrics.totalReturn,
		w.testMetrics.totalReturn,
		w.testMetrics.alpha,
		w.testMetrics.sharpeRatio,
		w.testMetrics.maxDrawdown,
		w.generalization.label,
	].join(','));

	writeFileSync(filepath, [header, ...rows].join('\n'), 'utf-8');
}

// ─── JSON Export ─────────────────────────────────────────────────────────────

export function exportRollingSummaryJSON(result: RollingResult, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	writeFileSync(filepath, JSON.stringify({
		strategy: result.strategyName,
		coin: result.coin,
		interval: result.interval,
		numWindows: result.numWindows,
		trainRatio: result.trainRatio,
		gitCommit: result.gitCommit,
		timestamp: result.timestamp,
		durationMs: result.durationMs,
		robustness: result.robustness,
		windows: result.windows.map((w) => ({
			window: w.windowIndex,
			params: formatParamLabel(w.bestParams),
			trainPeriod: `${w.trainPeriod.start}/${w.trainPeriod.end}`,
			testPeriod: `${w.testPeriod.start}/${w.testPeriod.end}`,
			trainReturn: w.trainMetrics.totalReturn,
			testReturn: w.testMetrics.totalReturn,
			testAlpha: w.testMetrics.alpha,
			testSharpe: w.testMetrics.sharpeRatio,
			testMaxDD: w.testMetrics.maxDrawdown,
			verdict: w.generalization.label,
			passed: w.passed,
		})),
	}, null, 2), 'utf-8');
}
