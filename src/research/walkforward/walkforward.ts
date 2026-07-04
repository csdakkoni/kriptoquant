// ============================================================================
// KRIPTOQUANT — Walk-Forward Validation Engine (Sprint 9)
// ============================================================================
// Train'de en iyi parametreyi bul → Test'te doğrula → Genellenebilirliği ölç.
// Overfitting'in bilimsel tespiti.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Candle, PlatformConfig, RiskConfig } from '../../core/types.js';
import { formatDate } from '../../core/utils.js';
import { splitData, type SplitResult, type TimePeriod } from './data-splitter.js';
import {
	generateCombinations,
	runExperiment,
	DEFAULT_SWEEP,
	type ExperimentParams,
	type ExperimentResult,
	type SweepConfig,
} from '../experiments/runner.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface WalkForwardMetrics {
	readonly totalReturn: number;
	readonly sharpeRatio: number;
	readonly profitFactor: number;
	readonly maxDrawdown: number;
	readonly totalTrades: number;
	readonly winRate: number;
	readonly alpha: number;
	readonly totalSignals: number;
	readonly acceptedSignals: number;
}

export interface GeneralizationScore {
	readonly retention: number;
	readonly label: string;
	readonly emoji: string;
}

export interface WalkForwardResult {
	readonly bestParams: ExperimentParams;
	readonly trainMetrics: WalkForwardMetrics;
	readonly testMetrics: WalkForwardMetrics;
	readonly generalization: GeneralizationScore;
	readonly trainPeriod: TimePeriod;
	readonly testPeriod: TimePeriod;
	readonly trainCombinations: number;
	readonly trainWithTrades: number;
	readonly durationMs: number;
}

// ─── Sweep Config Filtresi ───────────────────────────────────────────────────

/**
 * Strateji adına göre sweep config'i filtreler.
 * "donchian-breakout" verilmişse sadece Donchian parametrelerini tutar.
 */
export function filterSweepByStrategy(config: SweepConfig, strategyName?: string): SweepConfig {
	if (!strategyName) return config;

	switch (strategyName) {
		case 'ema-cross':
			return { ...config, donchianPeriod: undefined };
		case 'donchian-breakout':
			return { ...config, emaFast: undefined, emaSlow: undefined };
		default:
			return config;
	}
}

// ─── Overfitting Detector ────────────────────────────────────────────────────

export function scoreGeneralization(trainReturn: number, testReturn: number): GeneralizationScore {
	if (testReturn < 0) {
		return { retention: 0, label: 'FAILED', emoji: '❌' };
	}

	if (trainReturn <= 0) {
		return { retention: 0, label: 'NO EDGE', emoji: '⚠️' };
	}

	const retention = (testReturn / trainReturn) * 100;

	if (retention >= 80) return { retention: Math.round(retention), label: 'EXCELLENT', emoji: '🟢' };
	if (retention >= 60) return { retention: Math.round(retention), label: 'GOOD', emoji: '🟡' };
	if (retention >= 40) return { retention: Math.round(retention), label: 'WEAK', emoji: '🟠' };
	return { retention: Math.round(retention), label: 'LIKELY OVERFIT', emoji: '🔴' };
}

// ─── Metrics Extractor ───────────────────────────────────────────────────────

export function extractMetrics(result: ExperimentResult): WalkForwardMetrics {
	return {
		totalReturn: result.totalReturn,
		sharpeRatio: result.sharpeRatio,
		profitFactor: result.profitFactor,
		maxDrawdown: result.maxDrawdown,
		totalTrades: result.totalTrades,
		winRate: result.winRate,
		alpha: result.alpha,
		totalSignals: result.totalSignals,
		acceptedSignals: result.acceptedSignals,
	};
}

// ─── Walk-Forward Engine ─────────────────────────────────────────────────────

/**
 * Walk-Forward Validation:
 * 1. Veriyi kronolojik olarak Train/Test'e böl
 * 2. Train'de tüm parametreleri tara
 * 3. En iyi parametreyi seç (Sharpe Ratio)
 * 4. Test'te o parametreyle tek backtest çalıştır
 * 5. Genellenebilirliği ölç
 */
export function runWalkForward(
	candles: Candle[],
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string,
	interval: string,
	strategyName?: string,
	trainRatio: number = 0.70,
): WalkForwardResult {
	const startTime = Date.now();

	// 1. Veriyi böl
	const { train, test, trainPeriod, testPeriod } = splitData(candles, trainRatio);

	console.log('');
	console.log('  🔬 Walk-Forward Validation başlıyor...');
	console.log(`  📊 Train : ${trainPeriod.start} → ${trainPeriod.end} (${train.length} mum)`);
	console.log(`  🧪 Test  : ${testPeriod.start} → ${testPeriod.end} (${test.length} mum)`);

	// 2. Train'de sweep
	const sweepConfig = filterSweepByStrategy(DEFAULT_SWEEP, strategyName);
	const combinations = generateCombinations(sweepConfig);

	console.log(`  ⚗️  Kombinasyon: ${combinations.length}`);
	console.log('');

	const trainResults: ExperimentResult[] = [];
	for (let i = 0; i < combinations.length; i++) {
		trainResults.push(runExperiment(train, combinations[i], platformConfig, riskConfig, coin));
		if ((i + 1) % 100 === 0 || i === combinations.length - 1) {
			process.stdout.write(`\r  ⏳ Train sweep: ${i + 1}/${combinations.length}`);
		}
	}
	console.log('');

	// 3. En iyi parametreyi bul (Sharpe Ratio)
	const withTrades = trainResults.filter((r) => r.totalTrades > 0);

	if (withTrades.length === 0) {
		// Hiçbir kombinasyon trade üretmedi
		const noEdgeParams = combinations[0];
		const noEdgeMetrics: WalkForwardMetrics = {
			totalReturn: 0, sharpeRatio: 0, profitFactor: 0, maxDrawdown: 0,
			totalTrades: 0, winRate: 0, alpha: 0, totalSignals: 0, acceptedSignals: 0,
		};

		return {
			bestParams: noEdgeParams,
			trainMetrics: noEdgeMetrics,
			testMetrics: noEdgeMetrics,
			generalization: { retention: 0, label: 'NO EDGE', emoji: '⚠️' },
			trainPeriod,
			testPeriod,
			trainCombinations: combinations.length,
			trainWithTrades: 0,
			durationMs: Date.now() - startTime,
		};
	}

	const best = withTrades.sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];

	console.log(`  ✅ Train'de en iyi: ${best.params.strategyName}`);
	console.log(`     Sharpe: ${best.sharpeRatio} | Return: ${best.totalReturn}%`);

	// 4. Test'te doğrula — aynı parametrelerle tek backtest
	const testResult = runExperiment(test, best.params, platformConfig, riskConfig, coin);

	console.log(`  🧪 Test sonucu: Return: ${testResult.totalReturn}% | Sharpe: ${testResult.sharpeRatio}`);

	// 5. Genellenebilirliği ölç
	const generalization = scoreGeneralization(best.totalReturn, testResult.totalReturn);

	return {
		bestParams: best.params,
		trainMetrics: extractMetrics(best),
		testMetrics: extractMetrics(testResult),
		generalization,
		trainPeriod,
		testPeriod,
		trainCombinations: combinations.length,
		trainWithTrades: withTrades.length,
		durationMs: Date.now() - startTime,
	};
}

// ─── Walk-Forward Report ─────────────────────────────────────────────────────

function formatParamLabel(p: ExperimentParams): string {
	if (p.emaFast != null) return `EMA ${p.emaFast}/${p.emaSlow}`;
	if (p.donchianPeriod != null) return `Donchian ${p.donchianPeriod}`;
	return p.strategyName;
}

export function printWalkForwardReport(result: WalkForwardResult): void {
	const divider = '═'.repeat(64);
	const thinDivider = '─'.repeat(64);
	const { trainMetrics: tr, testMetrics: ts, generalization: gen } = result;

	console.log('');
	console.log(divider);
	console.log('  🔬 WALK-FORWARD VALIDATION REPORT');
	console.log(divider);

	// Best Params
	console.log('');
	console.log(thinDivider);
	console.log('  🏆 Best Parameters (Train)');
	console.log(thinDivider);
	console.log(`  Strategy      : ${result.bestParams.strategyName}`);
	console.log(`  Params        : ${formatParamLabel(result.bestParams)}`);
	console.log(`  ADX Threshold : ${result.bestParams.adxVetoThreshold}`);
	console.log(`  RVOL Threshold: ${result.bestParams.rvolVetoThreshold}`);
	console.log(`  Min Confidence: ${result.bestParams.minimumConfidence}`);

	// Train Metrics
	console.log('');
	console.log(thinDivider);
	console.log(`  📊 TRAIN (${result.trainPeriod.start} → ${result.trainPeriod.end})`);
	console.log(thinDivider);
	console.log(`  Return        : ${tr.totalReturn > 0 ? '+' : ''}${tr.totalReturn}%`);
	console.log(`  Alpha         : ${tr.alpha > 0 ? '+' : ''}${tr.alpha}%`);
	console.log(`  Sharpe        : ${tr.sharpeRatio}`);
	console.log(`  Profit Factor : ${tr.profitFactor}`);
	console.log(`  Max Drawdown  : -${tr.maxDrawdown}%`);
	console.log(`  Trades        : ${tr.totalTrades} (Win: ${tr.winRate}%)`);
	console.log(`  Signals       : ${tr.totalSignals} (Accepted: ${tr.acceptedSignals})`);

	// Test Metrics
	console.log('');
	console.log(thinDivider);
	console.log(`  🧪 TEST (${result.testPeriod.start} → ${result.testPeriod.end})`);
	console.log(thinDivider);
	console.log(`  Return        : ${ts.totalReturn > 0 ? '+' : ''}${ts.totalReturn}%`);
	console.log(`  Alpha         : ${ts.alpha > 0 ? '+' : ''}${ts.alpha}%`);
	console.log(`  Sharpe        : ${ts.sharpeRatio}`);
	console.log(`  Profit Factor : ${ts.profitFactor}`);
	console.log(`  Max Drawdown  : -${ts.maxDrawdown}%`);
	console.log(`  Trades        : ${ts.totalTrades} (Win: ${ts.winRate}%)`);
	console.log(`  Signals       : ${ts.totalSignals} (Accepted: ${ts.acceptedSignals})`);

	// Generalization Score
	console.log('');
	console.log(divider);
	console.log('  🎯 GENERALIZATION SCORE');
	console.log(divider);
	console.log('');
	console.log(`  Train Return  : ${tr.totalReturn > 0 ? '+' : ''}${tr.totalReturn}%`);
	console.log(`                    ↓`);
	console.log(`  Test Return   : ${ts.totalReturn > 0 ? '+' : ''}${ts.totalReturn}%`);
	console.log('');

	if (gen.retention > 0) {
		console.log(`  Retention     : ${gen.retention}%`);
	}

	console.log(`  Verdict       : ${gen.emoji} ${gen.label}`);
	console.log('');
	console.log(`  Combinations  : ${result.trainCombinations} (${result.trainWithTrades} had trades)`);
	console.log(`  Duration      : ${result.durationMs}ms`);
	console.log('');
	console.log(divider);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function exportWalkForwardJSON(result: WalkForwardResult, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf-8');
}

export function exportWalkForwardCSV(result: WalkForwardResult, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const header = [
		'Strategy', 'Params',
		'TrainPeriod', 'TestPeriod',
		'TrainReturn', 'TrainSharpe', 'TrainPF', 'TrainMaxDD', 'TrainTrades',
		'TestReturn', 'TestSharpe', 'TestPF', 'TestMaxDD', 'TestTrades',
		'Retention', 'Verdict',
	].join(',');

	const row = [
		result.bestParams.strategyName,
		formatParamLabel(result.bestParams),
		`${result.trainPeriod.start}/${result.trainPeriod.end}`,
		`${result.testPeriod.start}/${result.testPeriod.end}`,
		result.trainMetrics.totalReturn,
		result.trainMetrics.sharpeRatio,
		result.trainMetrics.profitFactor,
		result.trainMetrics.maxDrawdown,
		result.trainMetrics.totalTrades,
		result.testMetrics.totalReturn,
		result.testMetrics.sharpeRatio,
		result.testMetrics.profitFactor,
		result.testMetrics.maxDrawdown,
		result.testMetrics.totalTrades,
		result.generalization.retention,
		result.generalization.label,
	].join(',');

	writeFileSync(filepath, `${header}\n${row}`, 'utf-8');
}
