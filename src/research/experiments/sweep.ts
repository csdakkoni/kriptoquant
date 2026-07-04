// ============================================================================
// KRIPTOQUANT — Parameter Sweep Orchestrator (Sprint 8 — Multi-Strategy)
// ============================================================================
// Worker Thread'lerle paralel parametre taraması.
// CSV export, Top-N Leaderboard, Strategy Comparison, Metadata.
// ============================================================================

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Candle, PlatformConfig, RiskConfig } from '../../core/types.js';
import { round } from '../../core/utils.js';
import type { ExperimentParams, ExperimentResult, SweepConfig } from './runner.js';
import { generateCombinations, runExperiment } from './runner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatParamLabel(p: ExperimentParams): string {
	if (p.emaFast != null) return `EMA ${p.emaFast}/${p.emaSlow}`;
	if (p.donchianPeriod != null) return `DC ${p.donchianPeriod}`;
	return p.strategyName;
}


export interface ExperimentMetadata {
	readonly experimentId: string;
	readonly timestamp: string;
	readonly gitCommit: string;
	readonly dataset: string;
	readonly durationMs: number;
	readonly parameterHash: string;
	readonly totalCombinations: number;
	readonly cpuCores: number;
	readonly mode: 'parallel' | 'sequential';
}

export interface SweepResult {
	readonly results: ExperimentResult[];
	readonly metadata: ExperimentMetadata;
}

// ─── Metadata ────────────────────────────────────────────────────────────────

function getGitCommit(): string {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
}

function computeParameterHash(sweepConfig: SweepConfig): string {
	return createHash('md5')
		.update(JSON.stringify(sweepConfig))
		.digest('hex')
		.slice(0, 12);
}

function generateExperimentId(): string {
	return createHash('md5')
		.update(`${Date.now()}-${Math.random()}`)
		.digest('hex')
		.slice(0, 8);
}

// ─── Parallel Sweep (Worker Threads) ─────────────────────────────────────────

const WORKER_PATH = fileURLToPath(new URL('./worker.ts', import.meta.url));

async function runParallelSweep(
	candles: Candle[],
	combinations: ExperimentParams[],
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string,
): Promise<ExperimentResult[]> {
	const numWorkers = Math.min(cpus().length, combinations.length);
	const chunkSize = Math.ceil(combinations.length / numWorkers);

	const workerPromises: Promise<ExperimentResult[]>[] = [];

	for (let i = 0; i < numWorkers; i++) {
		const chunk = combinations.slice(i * chunkSize, (i + 1) * chunkSize);
		if (chunk.length === 0) continue;

		const promise = new Promise<ExperimentResult[]>((resolve, reject) => {
			const worker = new Worker(WORKER_PATH, {
				workerData: { candles, combinations: chunk, platformConfig, riskConfig, coin },
			});

			worker.on('message', (results: ExperimentResult[]) => {
				resolve(results);
			});

			worker.on('error', reject);

			worker.on('exit', (code) => {
				if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
			});
		});

		workerPromises.push(promise);
	}

	const chunks = await Promise.all(workerPromises);
	return chunks.flat();
}

// ─── Sequential Fallback ─────────────────────────────────────────────────────

function runSequentialSweep(
	candles: Candle[],
	combinations: ExperimentParams[],
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string,
	onProgress?: (completed: number, total: number) => void,
): ExperimentResult[] {
	const results: ExperimentResult[] = [];

	for (let i = 0; i < combinations.length; i++) {
		results.push(runExperiment(candles, combinations[i], platformConfig, riskConfig, coin));
		onProgress?.(i + 1, combinations.length);
	}

	return results;
}

// ─── Ana Sweep Fonksiyonu ────────────────────────────────────────────────────

/**
 * Parametre taramasını çalıştırır. Worker threads destekliyorsa paralel çalışır,
 * yoksa sıralı fallback kullanır.
 */
export async function runSweep(
	candles: Candle[],
	sweepConfig: SweepConfig,
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string,
	interval: string,
): Promise<SweepResult> {
	const combinations = generateCombinations(sweepConfig);
	const startTime = Date.now();
	let mode: 'parallel' | 'sequential' = 'parallel';
	let results: ExperimentResult[];

	console.log(`\n  ⚗️  Parameter Sweep başlıyor...`);
	console.log(`  📊 Kombinasyon: ${combinations.length}`);
	console.log(`  💻 CPU Çekirdek: ${cpus().length}`);
	console.log('');

	try {
		results = await runParallelSweep(candles, combinations, platformConfig, riskConfig, coin);
		console.log(`  ✅ Paralel çalıştırma tamamlandı (${cpus().length} worker)`);
	} catch (err) {
		console.log(`  ⚠️  Worker threads başarısız, sıralı moda geçiliyor...`);
		mode = 'sequential';

		results = runSequentialSweep(
			candles, combinations, platformConfig, riskConfig, coin,
			(done, total) => {
				if (done % 50 === 0 || done === total) {
					process.stdout.write(`\r  ⏳ İlerleme: ${done}/${total}`);
				}
			},
		);
		console.log('');
	}

	const durationMs = Date.now() - startTime;

	const metadata: ExperimentMetadata = {
		experimentId: generateExperimentId(),
		timestamp: new Date().toISOString(),
		gitCommit: getGitCommit(),
		dataset: `${coin}/${interval}/${candles.length} candles`,
		durationMs,
		parameterHash: computeParameterHash(sweepConfig),
		totalCombinations: combinations.length,
		cpuCores: cpus().length,
		mode,
	};

	return { results, metadata };
}

// ─── Top-N Leaderboard ───────────────────────────────────────────────────────

/**
 * Sonuçları Sharpe Ratio'ya göre sıralayıp terminalde gösterir.
 */
export function printLeaderboard(results: ExperimentResult[], topN: number = 20): void {
	const sorted = [...results]
		.filter((r) => r.totalTrades > 0)
		.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

	const divider = '═'.repeat(64);
	const thinDivider = '─'.repeat(64);

	console.log('');
	console.log(divider);
	console.log(`  🏆 PARAMETER SWEEP — Top ${Math.min(topN, sorted.length)} Leaderboard`);
	console.log(divider);

	if (sorted.length === 0) {
		console.log('');
		console.log('  ⚠️  Hiçbir kombinasyon trade üretmedi.');
		console.log('  💡 Filtre eşiklerini düşürmeyi deneyin.');
		console.log('');

		// Trade üretmeyenlerden en çok sinyal kabul edenleri göster
		const byAccepted = [...results].sort((a, b) => b.acceptedSignals - a.acceptedSignals);
		if (byAccepted.length > 0 && byAccepted[0].acceptedSignals > 0) {
			console.log('  📊 En çok sinyal kabul eden 5 kombinasyon:');
			console.log(thinDivider);
			for (const r of byAccepted.slice(0, 5)) {
				const p = r.params;
				const label = formatParamLabel(p);
				console.log(
					`  ${label} | ADX ${p.adxVetoThreshold} | RVOL ${p.rvolVetoThreshold} | ` +
					`Conf ${p.minimumConfidence} → Accepted: ${r.acceptedSignals}/${r.totalSignals}`,
				);
			}
		}

		console.log('');
		console.log(divider);
		return;
	}

	const top = sorted.slice(0, topN);

	for (let i = 0; i < top.length; i++) {
		const r = top[i];
		const p = r.params;

		console.log('');
		console.log(thinDivider);
		console.log(`  #${i + 1}  [${p.strategyName.toUpperCase()}]`);
		console.log(thinDivider);
		console.log(`  Strategy      : ${p.strategyName}`);
		if (p.emaFast != null) console.log(`  EMA           : ${p.emaFast}/${p.emaSlow}`);
		if (p.donchianPeriod != null) console.log(`  Donchian      : ${p.donchianPeriod}`);
		console.log(`  ADX Threshold : ${p.adxVetoThreshold}`);
		console.log(`  RVOL Threshold: ${p.rvolVetoThreshold}`);
		console.log(`  Min Confidence: ${p.minimumConfidence}`);
		console.log(`  ────────────────────────────`);
		console.log(`  Return        : ${r.totalReturn > 0 ? '+' : ''}${r.totalReturn}%`);
		console.log(`  Alpha         : ${r.alpha > 0 ? '+' : ''}${r.alpha}%`);
		console.log(`  Sharpe        : ${r.sharpeRatio}`);
		console.log(`  Profit Factor : ${r.profitFactor}`);
		console.log(`  Max Drawdown  : -${r.maxDrawdown}%`);
		console.log(`  Trades        : ${r.totalTrades} (Win: ${r.winRate}%)`);
		console.log(`  Signals       : ${r.totalSignals} (Accepted: ${r.acceptedSignals})`);
	}

	console.log('');
	console.log(divider);
}

// ─── Experiment Metadata Yazdır ──────────────────────────────────────────────

export function printMetadata(metadata: ExperimentMetadata): void {
	const divider = '═'.repeat(64);

	console.log('');
	console.log(divider);
	console.log('  🔬 Experiment Metadata');
	console.log(divider);
	console.log(`  ID            : ${metadata.experimentId}`);
	console.log(`  Timestamp     : ${metadata.timestamp}`);
	console.log(`  Git Commit    : ${metadata.gitCommit}`);
	console.log(`  Dataset       : ${metadata.dataset}`);
	console.log(`  Duration      : ${metadata.durationMs}ms`);
	console.log(`  Param Hash    : ${metadata.parameterHash}`);
	console.log(`  Combinations  : ${metadata.totalCombinations}`);
	console.log(`  Mode          : ${metadata.mode} (${metadata.cpuCores} cores)`);
	console.log(divider);
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

/**
 * Tüm deney sonuçlarını CSV'ye yazar.
 */
export function exportSweepCSV(
	results: ExperimentResult[],
	metadata: ExperimentMetadata,
	filepath: string,
): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const header = 'Strategy,emaFast,emaSlow,donchianPeriod,adxThreshold,rvolThreshold,minConfidence,Return,Sharpe,ProfitFactor,MaxDrawdown,Trades,WinRate,Alpha,Signals,Accepted,Rejected';

	const rows = results.map((r) => {
		const p = r.params;
		return [
			p.strategyName,
			p.emaFast ?? '',
			p.emaSlow ?? '',
			p.donchianPeriod ?? '',
			p.adxVetoThreshold,
			p.rvolVetoThreshold,
			p.minimumConfidence,
			r.totalReturn,
			r.sharpeRatio,
			r.profitFactor,
			r.maxDrawdown,
			r.totalTrades,
			r.winRate,
			r.alpha,
			r.totalSignals,
			r.acceptedSignals,
			r.rejectedSignals,
		].join(',');
	});

	writeFileSync(filepath, [header, ...rows].join('\n'), 'utf-8');
}

/**
 * Experiment metadata'yı JSON olarak kaydeder.
 */
export function exportMetadataJSON(metadata: ExperimentMetadata, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	writeFileSync(filepath, JSON.stringify(metadata, null, 2), 'utf-8');
}

// ─── Strategy Comparison Report ─────────────────────────────────────────

/**
 * Her stratejinin en iyi performansını yan yana karşılaştırır.
 */
export function printStrategyComparison(results: ExperimentResult[]): void {
	// Stratejilere göre grupla
	const byStrategy = new Map<string, ExperimentResult[]>();
	for (const r of results) {
		const list = byStrategy.get(r.params.strategyName) ?? [];
		list.push(r);
		byStrategy.set(r.params.strategyName, list);
	}

	if (byStrategy.size < 2) return; // Tek strateji varsa karşılaştırma anlamsız

	const divider = '═'.repeat(64);
	const thinDivider = '─'.repeat(64);

	console.log('');
	console.log(divider);
	console.log('  ⚔️  Strategy Comparison — Best of Each');
	console.log(divider);

	// Header
	console.log('');
	console.log(
		'  ' +
		'Strategy'.padEnd(20) +
		'Return'.padStart(10) +
		'Alpha'.padStart(10) +
		'Sharpe'.padStart(8) +
		'PF'.padStart(6) +
		'Trades'.padStart(8),
	);
	console.log(`  ${thinDivider}`);

	for (const [name, stratResults] of byStrategy) {
		const withTrades = stratResults.filter((r) => r.totalTrades > 0);

		if (withTrades.length === 0) {
			console.log(
				'  ' +
				name.padEnd(20) +
				'(no trades)'.padStart(10),
			);
			continue;
		}

		// Sharpe'a göre en iyi
		const best = withTrades.sort((a, b) => b.sharpeRatio - a.sharpeRatio)[0];
		const label = formatParamLabel(best.params);

		console.log(
			'  ' +
			`${name} (${label})`.padEnd(20) +
			`${best.totalReturn > 0 ? '+' : ''}${best.totalReturn}%`.padStart(10) +
			`${best.alpha > 0 ? '+' : ''}${best.alpha}%`.padStart(10) +
			`${best.sharpeRatio}`.padStart(8) +
			`${best.profitFactor}`.padStart(6) +
			`${best.totalTrades}`.padStart(8),
		);
	}

	console.log('');
	console.log(divider);
}
