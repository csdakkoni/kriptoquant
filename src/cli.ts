// ============================================================================
// KRIPTOQUANT — CLI Entry Point (Sprint 9)
// ============================================================================
// Platformun tek giriş noktası. Her şey terminalden başlar.
// Kullanım:
//   npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d
//   npx tsx src/cli.ts backtest --strategy donchian-breakout --coin BTCUSDT
//   npx tsx src/cli.ts sweep --coin BTCUSDT --interval 1d
//   npx tsx src/cli.ts walkforward --coin BTCUSDT --interval 1d
// ============================================================================

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformConfig, RiskConfig, Strategy, StrategyDefaultsConfig } from './core/types.js';
import { log, logError } from './core/utils.js';
import { fetchAndStore } from './data/fetcher.js';
import { loadCandles } from './data/store.js';
import { runBacktest } from './research/backtester.js';
import { exportEquityCurve } from './research/equity-export.js';
import { exportTradeJournal } from './research/journal.js';
import { exportSignalJournal } from './research/analytics/signal-analyzer.js';
import { printReport, saveReport } from './research/report.js';
import { createSmaCrossStrategy } from './research/strategies/sma-cross/index.js';
import { createEmaCrossStrategy } from './research/strategies/ema-cross/index.js';
import { createDonchianBreakoutStrategy } from './research/strategies/donchian-breakout/index.js';
import { createA2Strategy } from './research/strategies/a2/index.js';
import { createConsensusStrategy } from './research/strategies/consensus/index.js';
import { createVwapReversionStrategy } from './research/strategies/vwap-reversion/index.js';
import { createBollingerRsiDivStrategy } from './research/strategies/bollinger-rsi-div/index.js';
import { createRandomStrategy } from './research/strategies/random/index.js';
import { createBollingerBandsV2Strategy } from './research/strategies/bollinger-bands-v2/index.js';
import { createA2V2Strategy } from './research/strategies/a2-v2/index.js';
import { createSupertrendStrategy } from './research/strategies/supertrend/index.js';
import { createMomentumBurstStrategy } from './research/strategies/momentum-burst/index.js';
import { createSwingDipStrategy } from './research/strategies/swing-dip/index.js';
import { createDonchianShortStrategy } from './research/strategies/donchian-short/index.js';
import { DEFAULT_SWEEP } from './research/experiments/runner.js';
import { runSweep, printLeaderboard, printMetadata, printStrategyComparison, exportSweepCSV, exportMetadataJSON } from './research/experiments/sweep.js';
import { runWalkForward, printWalkForwardReport, exportWalkForwardJSON, exportWalkForwardCSV } from './research/walkforward/walkforward.js';
import { runRollingWalkForward, printRollingReport, exportRollingCSV, exportRollingSummaryJSON } from './research/walkforward/rolling.js';
import { PaperBroker } from './execution/paper-broker.js';
import { runExecution } from './execution/engine.js';
import { CSVProvider } from './data/csv-provider.js';
import { CSVTradeLogger } from './execution/trade-logger.js';
import { runMultiAssetResearch } from './research/multi-asset/runner.js';
import { aggregateResearchResults } from './research/multi-asset/aggregator.js';
import { printMultiAssetReport, exportMultiAssetCSV, exportMultiAssetJSON } from './research/multi-asset/reporter.js';
import { createStrategyFromConfig } from './research/strategies/factory/index.js';
import type { StrategyConfig } from './research/strategies/factory/types.js';
import { CSVTimelineProvider } from './execution/portfolio/timeline-provider.js';
import { EqualWeightAllocation, RiskBudgetAllocation } from './execution/portfolio/allocation.js';
import { runPortfolioExecution } from './execution/portfolio/portfolio-engine.js';
import { runDiscoveryPipeline } from './research/discovery/pipeline.js';
import type { DiscoveryReport } from './research/discovery/types.js';
import { runMonteCarlo } from './research/analytics/monte-carlo.js';
import { startDashboardServer } from './dashboard/server.js';
import { startExecutionEngine } from './live/live-engine.js';
import { runValidationLab } from './research/validation-lab.js';

// Konfigürasyonları yükle
import defaultConfig from '../config/default.json' with { type: 'json' };
import riskConfig from '../config/risk.json' with { type: 'json' };
import strategyDefaultsJson from '../config/strategy-defaults.json' with { type: 'json' };

const platformConfig = defaultConfig as PlatformConfig;
const riskParams = riskConfig as RiskConfig;
const strategyDefaults = strategyDefaultsJson as StrategyDefaultsConfig;

// ─── Strateji Kayıt Defteri ──────────────────────────────────────────────────

/**
 * Strateji adından strateji nesnesini çözümler.
 * Yeni strateji eklemek = buraya bir satır eklemek.
 */
function resolveStrategy(name: string): Strategy | null {
	const strategies: Record<string, Strategy> = {
		'sma-cross': createSmaCrossStrategy(),
		'ema-cross': createEmaCrossStrategy(),
		'donchian-breakout': createDonchianBreakoutStrategy(),
		'a2': createA2Strategy(),
		'consensus': createConsensusStrategy(),
		'vwap-reversion': createVwapReversionStrategy(),
		'bollinger-rsi-div': createBollingerRsiDivStrategy(),
		'random': createRandomStrategy(),
		'bollinger-bands-v2': createBollingerBandsV2Strategy(),
		'a2-v2': createA2V2Strategy(),
		'supertrend': createSupertrendStrategy(),
		'momentum-burst': createMomentumBurstStrategy(),
		'swing-dip': createSwingDipStrategy(),
		'donchian-short': createDonchianShortStrategy(),
	};
	return strategies[name] ?? null;
}

// ─── Komutlar ────────────────────────────────────────────────────────────────

async function commandFetch(coin: string, interval: string): Promise<void> {
	log(`Veri çekme başlıyor: ${coin} (${interval})`);
	const candles = await fetchAndStore(coin, interval, { force: true });
	log(`Tamamlandı: ${candles.length} mum verisi kaydedildi.`);
}

async function commandBacktest(
	strategyName: string,
	coin: string,
	interval: string,
	mcOptions?: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
	},
): Promise<void> {
	const strategy = resolveStrategy(strategyName);
	if (!strategy) {
		logError(`Bilinmeyen strateji: ${strategyName}`);
		logError('Mevcut stratejiler: sma-cross, ema-cross, donchian-breakout, a2, consensus, vwap-reversion, bollinger-rsi-div, random, bollinger-bands-v2, a2-v2, supertrend');
		process.exit(1);
	}

	const provider = new CSVProvider();
	const candles = await provider.getHistory(coin, interval);

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`Backtest başlıyor: ${strategy.name} / ${coin} / ${interval}`);
	const result = runBacktest(strategy, candles, platformConfig, riskParams, coin, strategyDefaults, mcOptions);

	// interval bilgisini sonuca ekle
	const enrichedResult = { ...result, interval };

	// Raporlar
	printReport(enrichedResult);
	saveReport(enrichedResult);

	// Trade Journal (CSV)
	const journalPath = exportTradeJournal(enrichedResult);
	console.log(`  📋 Trade Journal: ${journalPath}`);

	// Signal Journal (CSV) — tüm sinyaller (accepted + rejected)
	if (enrichedResult.analyzedSignals && enrichedResult.analyzedSignals.length > 0) {
		const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
		const signalPath = `results/signals_${strategy.name}_${coin}_${timestamp}.csv`;
		exportSignalJournal(enrichedResult.analyzedSignals, signalPath);
		console.log(`  📊 Signal Journal: ${signalPath}`);
	}

	// Equity Curve (CSV)
	const equityPath = exportEquityCurve(enrichedResult);
	console.log(`  📉 Equity Curve : ${equityPath}`);
}

async function commandBacktestConfig(
	configPath: string,
	coin: string,
	interval: string,
	mcOptions?: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
	},
): Promise<void> {
	if (!configPath) {
		logError('Hata: --config seçeneğiyle bir JSON dosyası belirtilmelidir.');
		process.exit(1);
	}

	let configJson: StrategyConfig;
	try {
		const raw = readFileSync(configPath, 'utf-8');
		configJson = JSON.parse(raw) as StrategyConfig;
	} catch (e) {
		logError(`Hata: Konfigürasyon dosyası okunamadı veya parse edilemedi: ${configPath}`);
		process.exit(1);
	}

	const provider = new CSVProvider();
	const candles = await provider.getHistory(coin, interval);

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`Strategy Factory: ${configJson.metadata.name} (v${configJson.metadata.version}) yükleniyor...`);
	const compiled = createStrategyFromConfig(configJson, candles);
	const strategy = compiled.strategy;

	log(`Backtest başlıyor (Config): ${strategy.name} / ${coin} / ${interval}`);
	const result = runBacktest(strategy, candles, platformConfig, riskParams, coin, strategyDefaults, mcOptions);

	const enrichedResult = { ...result, interval };

	// Raporlar
	printReport(enrichedResult);
	saveReport(enrichedResult);

	// Trade Journal (CSV)
	const journalPath = exportTradeJournal(enrichedResult);
	console.log(`  📋 Trade Journal: ${journalPath}`);

	// Signal Journal (CSV)
	if (enrichedResult.analyzedSignals && enrichedResult.analyzedSignals.length > 0) {
		const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
		const signalPath = `results/signals_${strategy.name}_${coin}_${timestamp}.csv`;
		exportSignalJournal(enrichedResult.analyzedSignals, signalPath);
		console.log(`  📊 Signal Journal: ${signalPath}`);
	}

	// Equity Curve (CSV)
	const equityPath = exportEquityCurve(enrichedResult);
	console.log(`  📉 Equity Curve : ${equityPath}`);
}

async function commandPortfolioBacktest(
	strategyNameOrConfig: string,
	coinsStr: string,
	interval: string,
	options: {
		allocation: 'equal' | 'risk-budget';
		riskPercent: number;
		maxPositions: number;
		simulationsCount: number;
		mcMethod: 'bootstrap' | 'shuffle';
		ruinPct: number;
	}
): Promise<void> {
	const coins = coinsStr.split(',').map((c) => c.trim()).filter(Boolean);
	if (coins.length === 0) {
		logError('Hata: --coins parametresiyle en az bir coin belirtilmelidir.');
		process.exit(1);
	}

	const provider = new CSVProvider();
	const candlesMap = new Map<string, import('./core/types.js').Candle[]>();
	const strategies = new Map<string, Strategy>();

	let isJson = false;
	try {
		if (strategyNameOrConfig.endsWith('.json')) isJson = true;
	} catch {}

	let configJson: StrategyConfig | undefined;
	if (isJson) {
		try {
			const raw = readFileSync(strategyNameOrConfig, 'utf-8');
			configJson = JSON.parse(raw) as StrategyConfig;
		} catch {
			logError(`Hata: Konfigürasyon dosyası okunamadı: ${strategyNameOrConfig}`);
			process.exit(1);
		}
	}

	for (const coin of coins) {
		const candles = await provider.getHistory(coin, interval);
		if (candles.length === 0) {
			logError(`${coin} için veri bulunamadı.`);
			process.exit(1);
		}
		candlesMap.set(coin, candles);

		if (configJson) {
			const compiled = createStrategyFromConfig(configJson, candles);
			strategies.set(coin, compiled.strategy);
		} else {
			const strategy = resolveStrategy(strategyNameOrConfig);
			if (!strategy) {
				logError(`Bilinmeyen strateji: ${strategyNameOrConfig}`);
				process.exit(1);
			}
			strategies.set(coin, strategy);
		}
	}

	const timelineProvider = new CSVTimelineProvider();
	const alignedTimeline = timelineProvider.alignCandles(candlesMap);

	const allocation = options.allocation === 'risk-budget'
		? new RiskBudgetAllocation(options.riskPercent, riskParams.stopLossAtrMultiplier)
		: new EqualWeightAllocation();

	log(`Portföy Backtest başlıyor: ${configJson ? configJson.metadata.name : strategyNameOrConfig} / Varlıklar: ${coins.join(', ')} / ${interval}`);
	const result = runPortfolioExecution(
		alignedTimeline,
		candlesMap,
		strategies,
		allocation,
		platformConfig,
		riskParams,
		{ maxPositions: options.maxPositions, preventDoublePosition: true },
		{
			method: options.mcMethod,
			simulationsCount: options.simulationsCount,
			ruinThresholdPercent: options.ruinPct,
		}
	);

	const enrichedResult = {
		...result,
		strategyName: configJson ? configJson.metadata.name : strategyNameOrConfig,
		coin: coins.join('+'),
		interval,
		startDate: alignedTimeline[0]?.timestamp ? new Date(alignedTimeline[0].timestamp).toISOString().slice(0, 10) : '',
		endDate: alignedTimeline[alignedTimeline.length - 1]?.timestamp ? new Date(alignedTimeline[alignedTimeline.length - 1].timestamp).toISOString().slice(0, 10) : '',
	};

	printReport(enrichedResult);
	saveReport(enrichedResult);

	const journalPath = exportTradeJournal(enrichedResult);
	console.log(`  📋 Trade Journal: ${journalPath}`);
	const equityPath = exportEquityCurve(enrichedResult);
	console.log(`  📉 Equity Curve : ${equityPath}`);
}

async function commandSweep(coin: string, interval: string): Promise<void> {
	const provider = new CSVProvider();
	const candles = await provider.getHistory(coin, interval);

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`${coin} verisi yüklendi: ${candles.length} mum`);

	const { results, metadata } = await runSweep(
		candles, DEFAULT_SWEEP, platformConfig, riskParams, coin, interval,
	);

	printLeaderboard(results);
	printStrategyComparison(results);
	printMetadata(metadata);

	// CSV Export
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const csvPath = `results/sweep_${coin}_${interval}_${timestamp}.csv`;
	exportSweepCSV(results, metadata, csvPath);
	console.log(`\n  💾 Sweep CSV: ${csvPath}`);

	// Metadata JSON
	const metaPath = `results/sweep_meta_${coin}_${interval}_${timestamp}.json`;
	exportMetadataJSON(metadata, metaPath);
	console.log(`  🔬 Metadata  : ${metaPath}`);
}

async function commandWalkForward(strategyName: string, coin: string, interval: string): Promise<void> {
	const provider = new CSVProvider();
	const candles = await provider.getHistory(coin, interval);

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`${coin} verisi yüklendi: ${candles.length} mum`);

	// Strateji filtresi: "all" veya boş ise tüm stratejileri tara
	const stratFilter = (strategyName === 'all' || strategyName === 'sma-cross') ? undefined : strategyName;

	const result = runWalkForward(
		candles, platformConfig, riskParams, coin, interval, stratFilter,
	);

	printWalkForwardReport(result);

	// Export
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const jsonPath = `results/walkforward_${coin}_${interval}_${timestamp}.json`;
	exportWalkForwardJSON(result, jsonPath);
	console.log(`\n  💾 JSON: ${jsonPath}`);

	const csvPath = `results/walkforward_${coin}_${interval}_${timestamp}.csv`;
	exportWalkForwardCSV(result, csvPath);
	console.log(`  📊 CSV : ${csvPath}`);
}

async function commandRollingWalkForward(strategyName: string, coin: string, interval: string): Promise<void> {
	const provider = new CSVProvider();
	const candles = await provider.getHistory(coin, interval);

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`${coin} verisi yüklendi: ${candles.length} mum`);

	const stratFilter = (strategyName === 'all' || strategyName === 'sma-cross') ? undefined : strategyName;

	const result = runRollingWalkForward(
		candles, platformConfig, riskParams, coin, interval, stratFilter,
	);

	printRollingReport(result);

	// Export
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const csvPath = `results/rolling_walkforward_${coin}_${interval}_${timestamp}.csv`;
	exportRollingCSV(result, csvPath);
	console.log(`\n  💾 CSV: ${csvPath}`);

	const jsonPath = `results/rolling_summary_${coin}_${interval}_${timestamp}.json`;
	exportRollingSummaryJSON(result, jsonPath);
	console.log(`  🔬 JSON: ${jsonPath}`);
}

async function commandPaperTrade(strategyName: string, coin: string, interval: string): Promise<void> {
	log(`\n================================================================`);
	log(`  🚀 STARTING LIVE PAPER TRADING ENGINE (DAEMON MODE)`);
	log(`  Strateji: ${strategyName}`);
	log(`  Coin     : ${coin}`);
	log(`  Interval : ${interval}`);
	log(`================================================================\n`);

	const coins = coin.split(',');

	// 1) Start the Dashboard server on port 3008 (custom clean port)
	startDashboardServer(3008);

	// 2) Start the in-process ExecutionEngine
	await startExecutionEngine(coins, interval, strategyName, (state: any) => {
		// Periodically print update status to console
		if (state.uptime % 10 === 0) {
			log(`[Live Engine Uptime: ${state.uptime}s] Equity: ${state.currentEquity.toFixed(2)} USDT | Cash: ${state.cash.toFixed(2)} | Active Positions: ${state.activePositions.length}`);
		}
	});

	log(`Live Paper Trading daemon is active. Visit: http://localhost:3008`);
	log(`Press Ctrl+C to terminate.`);
	
	// Keep process alive indefinitely
	await new Promise(() => {});
}

async function commandMultiAsset(strategyName: string, coinsStr?: string, intervalsStr?: string): Promise<void> {
	const strategy = resolveStrategy(strategyName);
	if (!strategy) {
		logError(`Bilinmeyen strateji: ${strategyName}`);
		logError('Mevcut stratejiler: sma-cross, ema-cross, donchian-breakout');
		process.exit(1);
	}

	const coins = coinsStr ? coinsStr.split(',') : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
	const intervals = intervalsStr ? intervalsStr.split(',') : ['4h', '1d'];

	log(`Çoklu varlık analizi başlıyor... Strateji: ${strategy.name}`);
	log(`Coinler  : ${coins.join(', ')}`);
	log(`Aralıklar: ${intervals.join(', ')}`);

	const results = await runMultiAssetResearch(
		{ coins, intervals, strategyName: strategy.name },
		platformConfig,
		riskParams,
	);

	const summary = aggregateResearchResults(results, strategy.name);

	printMultiAssetReport(summary);

	// Exporters
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const csvFilename = `results/multi_asset_${strategy.name}_${timestamp}.csv`;
	exportMultiAssetCSV(summary, csvFilename);
	console.log(`  💾 CSV: ${csvFilename}`);

	const jsonFilename = `results/multi_asset_summary_${strategy.name}_${timestamp}.json`;
	exportMultiAssetJSON(summary, jsonFilename);
	console.log(`  🔬 JSON: ${jsonFilename}`);
}

async function commandValidationLab(coinsStr?: string, intervalsStr?: string, startDate?: string, endDate?: string): Promise<void> {
	const coins = coinsStr ? coinsStr.split(',') : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LTCUSDT', 'LINKUSDT', 'AVAXUSDT'];
	const intervals = intervalsStr ? intervalsStr.split(',') : ['4h', '1d'];

	log(`\n====================================================`);
	log(`🔬 VALIDATION LAB — PARAMETRIC MATRIX SWEEP & SIGNIFICANCE`);
	log(`====================================================`);
	log(`Assets   : ${coins.join(', ')}`);
	log(`Intervals: ${intervals.join(', ')}`);

	const report = await runValidationLab({
		coins,
		intervals,
		startDate,
		endDate
	});

	log(`\nValidation complete. Matrix Runs: ${report.totalBacktestsRun}`);
	
	// Helper function to print Table 1 row (Significance & Adjusted P-values)
	const printTable1Row = (row: any, rawRow?: any) => {
		let sigStr = '❌ NO';
		if (row.isSignificant) {
			if (rawRow) {
				sigStr = row.totalReturnPercent > rawRow.totalReturnPercent ? '✅ YES (Improved)' : '✅ YES (Degraded)';
			} else {
				sigStr = '✅ YES';
			}
		}
		const pTStr = row.pValueTTestAdjusted === 1.0 ? '-' : row.pValueTTestAdjusted.toFixed(4);
		const pWStr = row.pValueWilcoxonAdjusted === 1.0 ? '-' : row.pValueWilcoxonAdjusted.toFixed(4);
		const dStr = row.cohensD === 0 ? '-' : row.cohensD.toFixed(3);
		const ciStr = row.ciLower === 0 && row.ciUpper === 0 ? '-' : `[${row.ciLower.toFixed(3)}, ${row.ciUpper.toFixed(3)}]`;
		
		return `| ${row.configName.padEnd(28)} | ${row.totalTrades.toString().padEnd(6)} | ${row.winRatePercent.toFixed(1)}%     | ${row.sharpeRatio.toFixed(2).padEnd(6)} | ${row.totalReturnPercent.toFixed(2).padEnd(8)} | ${row.maxDrawdownPercent.toFixed(2).padEnd(8)} | ${pTStr.padEnd(12)} | ${pWStr.padEnd(13)} | ${dStr.padEnd(7)} | ${ciStr.padEnd(16)} | ${sigStr.padEnd(16)} |`;
	};

	// Helper function to print Table 2 row (Advanced Performance Metrics)
	const printTable2Row = (row: any) => {
		return `| ${row.configName.padEnd(28)} | ${row.sortinoRatio.toFixed(2).padEnd(7)} | ${row.calmarRatio.toFixed(2).padEnd(6)} | ${row.marRatio.toFixed(2).padEnd(5)} | ${row.longestDrawdownDays.toString().padEnd(11)} | ${row.avgRecoveryTimeDays.toFixed(1).padEnd(13)} | ${row.medianRecoveryTimeDays.toFixed(1).padEnd(13)} | ${row.timeUnderWaterPercent.toFixed(1).padEnd(18)}% | ${row.sqn.toFixed(2).padEnd(5)} | ${row.payoffRatio.toFixed(2).padEnd(12)} | ${row.kellyPercent.toFixed(1).padEnd(7)}% |`;
	};

	const table1Header = 
		`| Configuration | Trades | Win Rate % | Sharpe | Return % | Max DD % | p-tTest(Adj) | p-Wilcox(Adj) | Cohen d | 95% CI Difference | Significant? |\n` +
		`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

	const table2Header = 
		`| Configuration | Sortino | Calmar | MAR   | Max DD Days | Avg Rec. Days | Med Rec. Days | Time Under Water % | SQN   | Payoff Ratio | Kelly % |\n` +
		`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

	console.log(`\n### Global Summary - Table 1: Significance & Adjusted P-values\n`);
	console.log(table1Header);
	const rawRow = report.summaryTable.find(r => r.configName === 'Raw Strategy')!;
	for (const row of report.summaryTable) {
		console.log(printTable1Row(row, rawRow));
	}
	console.log('');

	console.log(`### Global Summary - Table 2: Advanced Portfolio Metrics\n`);
	console.log(table2Header);
	for (const row of report.summaryTable) {
		console.log(printTable2Row(row));
	}
	console.log('');

	// Print Per-Asset Breakdowns
	for (const coin of coins) {
		const rows = report.assetBreakdowns[coin];
		if (!rows) continue;
		const rawAssetRow = rows.find(r => r.configName === 'Raw Strategy')!;

		console.log(`### Asset Breakdown: ${coin} - Table 1: Significance & Adjusted P-values\n`);
		console.log(table1Header);
		for (const row of rows) {
			console.log(printTable1Row(row, rawAssetRow));
		}
		console.log('');

		console.log(`### Asset Breakdown: ${coin} - Table 2: Advanced Portfolio Metrics\n`);
		console.log(table2Header);
		for (const row of rows) {
			console.log(printTable2Row(row));
		}
		console.log('');
	}

	// Generate Markdown Report content
	let md = `# Validation Lab Report\n\n`;
	md += `Generated: ${new Date().toISOString()}\n`;
	md += `- **Matrix Size:** ${coins.length} coins x ${intervals.length} intervals x 4 ablation configurations\n`;
	md += `- **Total Backtests Executed:** ${report.totalBacktestsRun}\n\n`;
	md += `## Methodology Summary\n`;
	md += `- **Multiple Comparisons Correction:** Holm-Bonferroni step-down correction applied to control Family-Wise Error Rate (FWER) across the 3 comparisons within each slice.\n`;
	md += `- **Statistical Tests:** Paired Two-Tailed t-test (parametric) and Paired Wilcoxon Signed-Rank test (non-parametric).\n`;
	md += `- **Sample Unit:** 90-day sub-period returns of the resampled equity curve.\n`;
	md += `- **Significance Level:** alpha = 0.05 (95% confidence).\n`;
	md += `- **Sharpe/Sortino:** Calculated on resampled daily equity returns, scaled by sqrt(365).\n\n`;

	md += `## Global Summary - Table 1: Significance & Adjusted P-values\n\n`;
	md += `| Configuration | Trades | Win Rate % | Sharpe | Return % | Max DD % | p-tTest(Adj) | p-Wilcox(Adj) | Cohen d | 95% CI Difference | Significant? |\n`;
	md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
	for (const row of report.summaryTable) {
		let sigStr = '❌ NO';
		if (row.isSignificant) {
			sigStr = row.totalReturnPercent > rawRow.totalReturnPercent ? '✅ YES (Improved)' : '✅ YES (Degraded)';
		}
		const pTStr = row.pValueTTestAdjusted === 1.0 ? '-' : row.pValueTTestAdjusted.toFixed(4);
		const pWStr = row.pValueWilcoxonAdjusted === 1.0 ? '-' : row.pValueWilcoxonAdjusted.toFixed(4);
		const dStr = row.cohensD === 0 ? '-' : row.cohensD.toFixed(3);
		const ciStr = row.ciLower === 0 && row.ciUpper === 0 ? '-' : `[${row.ciLower.toFixed(3)}, ${row.ciUpper.toFixed(3)}]`;
		md += `| ${row.configName} | ${row.totalTrades} | ${row.winRatePercent.toFixed(1)}% | ${row.sharpeRatio.toFixed(2)} | ${row.totalReturnPercent.toFixed(2)}% | ${row.maxDrawdownPercent.toFixed(2)}% | ${pTStr} | ${pWStr} | ${dStr} | ${ciStr} | ${sigStr} |\n`;
	}
	md += `\n`;

	md += `## Global Summary - Table 2: Advanced Portfolio Metrics\n\n`;
	md += `| Configuration | Sortino | Calmar | MAR | Max DD Days | Avg Rec. Days | Med Rec. Days | Time Under Water % | SQN | Payoff Ratio | Kelly % |\n`;
	md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
	for (const row of report.summaryTable) {
		md += `| ${row.configName} | ${row.sortinoRatio.toFixed(2)} | ${row.calmarRatio.toFixed(2)} | ${row.marRatio.toFixed(2)} | ${row.longestDrawdownDays} | ${row.avgRecoveryTimeDays.toFixed(1)} | ${row.medianRecoveryTimeDays.toFixed(1)} | ${row.timeUnderWaterPercent.toFixed(1)}% | ${row.sqn.toFixed(2)} | ${row.payoffRatio.toFixed(2)} | ${row.kellyPercent.toFixed(1)}% |\n`;
	}
	md += `\n`;

	for (const coin of coins) {
		const rows = report.assetBreakdowns[coin];
		if (!rows) continue;
		const rawAssetRow = rows.find(r => r.configName === 'Raw Strategy')!;
		
		md += `## Asset Breakdown: ${coin} - Table 1: Significance & Adjusted P-values\n\n`;
		md += `| Configuration | Trades | Win Rate % | Sharpe | Return % | Max DD % | p-tTest(Adj) | p-Wilcox(Adj) | Cohen d | 95% CI Difference | Significant? |\n`;
		md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
		for (const row of rows) {
			let sigStr = '❌ NO';
			if (row.isSignificant) {
				sigStr = row.totalReturnPercent > rawAssetRow.totalReturnPercent ? '✅ YES (Improved)' : '✅ YES (Degraded)';
			}
			const pTStr = row.pValueTTestAdjusted === 1.0 ? '-' : row.pValueTTestAdjusted.toFixed(4);
			const pWStr = row.pValueWilcoxonAdjusted === 1.0 ? '-' : row.pValueWilcoxonAdjusted.toFixed(4);
			const dStr = row.cohensD === 0 ? '-' : row.cohensD.toFixed(3);
			const ciStr = row.ciLower === 0 && row.ciUpper === 0 ? '-' : `[${row.ciLower.toFixed(3)}, ${row.ciUpper.toFixed(3)}]`;
			md += `| ${row.configName} | ${row.totalTrades} | ${row.winRatePercent.toFixed(1)}% | ${row.sharpeRatio.toFixed(2)} | ${row.totalReturnPercent.toFixed(2)}% | ${row.maxDrawdownPercent.toFixed(2)}% | ${pTStr} | ${pWStr} | ${dStr} | ${ciStr} | ${sigStr} |\n`;
		}
		md += `\n`;

		md += `## Asset Breakdown: ${coin} - Table 2: Advanced Portfolio Metrics\n\n`;
		md += `| Configuration | Sortino | Calmar | MAR | Max DD Days | Avg Rec. Days | Med Rec. Days | Time Under Water % | SQN | Payoff Ratio | Kelly % |\n`;
		md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
		for (const row of rows) {
			md += `| ${row.configName} | ${row.sortinoRatio.toFixed(2)} | ${row.calmarRatio.toFixed(2)} | ${row.marRatio.toFixed(2)} | ${row.longestDrawdownDays} | ${row.avgRecoveryTimeDays.toFixed(1)} | ${row.medianRecoveryTimeDays.toFixed(1)} | ${row.timeUnderWaterPercent.toFixed(1)}% | ${row.sqn.toFixed(2)} | ${row.payoffRatio.toFixed(2)} | ${row.kellyPercent.toFixed(1)}% |\n`;
		}
		md += `\n`;
	}

	const outputPath = join(process.cwd(), 'results', 'validation_lab_report.md');
	writeFileSync(outputPath, md, 'utf-8');
	log(`Validation Lab report successfully written to: ${outputPath}\n`);
}

async function commandAlphaDiscover(
	coinsStr: string,
	candidatesCount: number,
	interval: string,
): Promise<void> {
	const coins = coinsStr.split(',').map((c) => c.trim()).filter(Boolean);
	if (coins.length === 0) {
		logError('Hata: --coins parametresiyle en az bir coin belirtilmelidir.');
		process.exit(1);
	}

	const report = await runDiscoveryPipeline(coins, candidatesCount, interval);
	printDiscoveryReportTable(report);
}

function printDiscoveryReportTable(report: DiscoveryReport): void {
	const divider = '─'.repeat(75);
	console.log('');
	console.log('═'.repeat(75));
	console.log('  🏆 ALPHA DISCOVERY LEADERBOARD (Top 10 Strateji)');
	console.log('═'.repeat(75));
	console.log('  Rank  Strateji Adı                 Score  Return  Drawdown  Sharpe  Trades');
	console.log(divider);

	const passed = report.results.filter((r) => r.stage === 'PASSED');
	if (passed.length === 0) {
		console.log('  ⚠️  Doğrulama zincirini (Quick, Multi-Asset, MC) geçen aday bulunamadı.');
		console.log(divider);
		return;
	}

	const sorted = [...passed].sort((a, b) => (b.score?.overall ?? 0) - (a.score?.overall ?? 0));
	const top10 = sorted.slice(0, 10);

	top10.forEach((r, idx) => {
		const rank = String(idx + 1).padStart(2);
		const name = r.id.padEnd(28).slice(0, 28);
		const score = (r.score?.overall ?? 0).toFixed(1).padStart(5);
		const ret = `${(r.totalReturn ?? 0) > 0 ? '+' : ''}${(r.totalReturn ?? 0).toFixed(1)}%`.padStart(7);
		const dd = `-${(r.maxDrawdown ?? 0).toFixed(1)}%`.padStart(9);
		const sharpe = (r.sharpeRatio ?? 0).toFixed(2).padStart(7);
		const trades = String(r.tradeCount ?? 0).padStart(7);

		console.log(`  #${rank}  ${name} ${score} ${ret} ${dd} ${sharpe} ${trades}`);
	});

	console.log(divider);
	console.log(`  Toplam Aday: ${report.totalCandidates} | Geçenler: ${report.passedCandidates} | Pareto Optimal: ${report.paretoFront.length}`);

	if (report.paretoFront.length > 0) {
		console.log('');
		console.log('  🎲 Pareto Optimal Adaylar (Return vs Drawdown vs Sharpe):');
		report.paretoFront.forEach((p) => {
			console.log(`    - ${p.id} (Skor: ${p.score?.overall} | Getiri: ${p.totalReturn}% | DD: -${p.maxDrawdown}% | Sharpe: ${p.sharpeRatio})`);
		});
	}
	console.log('═'.repeat(75));
}

async function commandVerifyE2e(): Promise<void> {
	console.log('═'.repeat(64));
	console.log('  🔬 KRIPTOQUANT — End-to-End Integration Verification');
	console.log('═'.repeat(64));

	const mockFile1 = 'data/raw/E2E_MOCK_1d.json';
	const mockFile2 = 'data/raw/E2E_MOCK2_1d.json';

	try {
		// 1) Mock mum verisi üret ve kaydet
		const candles1: import('./core/types.js').Candle[] = [];
		const candles2: import('./core/types.js').Candle[] = [];
		let price1 = 100;
		let price2 = 50;
		const now = Date.now() - 120 * 86400000;
		for (let i = 0; i < 120; i++) {
			const t = now + i * 86400000;
			price1 += i > 20 && i < 60 ? 2 : i > 60 && i < 100 ? -2.5 : 0.2;
			price2 += i > 30 && i < 70 ? 1 : i > 70 && i < 110 ? -1.2 : 0.1;

			candles1.push({
				openTime: t,
				closeTime: t + 86400000,
				open: price1 - 0.1,
				high: price1 + 2,
				low: price1 - 2,
				close: price1,
				volume: 1000,
			});
			candles2.push({
				openTime: t,
				closeTime: t + 86400000,
				open: price2 - 0.1,
				high: price2 + 1,
				low: price2 - 1,
				close: price2,
				volume: 500,
			});
		}

		if (!existsSync('data/raw')) {
			mkdirSync('data/raw', { recursive: true });
		}
		writeFileSync(mockFile1, JSON.stringify(candles1, null, 2), 'utf-8');
		writeFileSync(mockFile2, JSON.stringify(candles2, null, 2), 'utf-8');
		console.log('  ✔ [Stage 1/8] Mock raw candles generated.');

		// 2) Strateji Derleme (Strategy Factory)
		const configJson: StrategyConfig = {
			metadata: { name: 'e2e-strat', version: '1.0.0', description: 'E2E Validation Strat' },
			warmupPeriod: 25,
			indicators: [
				{ id: 'fast', type: 'ema', params: [9] },
				{ id: 'slow', type: 'ema', params: [21] },
				{ id: 'rsi', type: 'rsi', params: [14] },
				{ id: 'atr', type: 'atr', params: [14] },
			],
			entry: {
				type: 'comparison',
				operator: '>',
				left: { type: 'indicator', id: 'fast' },
				right: { type: 'indicator', id: 'slow' },
			},
			exit: {
				type: 'comparison',
				operator: '<',
				left: { type: 'indicator', id: 'fast' },
				right: { type: 'indicator', id: 'slow' },
			},
		};
		const compiled = createStrategyFromConfig(configJson, candles1);
		console.log(`  ✔ [Stage 2/8] Strategy Factory successfully compiled strategy: ${compiled.strategy.name}`);

		// 3) Single asset Backtest
		const backtestResult = runBacktest(compiled.strategy, candles1, platformConfig, riskParams, 'E2E_MOCK');
		console.log(`  ✔ [Stage 3/8] Single-asset backtest run completed. Trades: ${backtestResult.totalTrades}`);

		// 4) Walk-Forward & Rolling Walk-Forward
		const rollingResult = runRollingWalkForward(candles1, platformConfig, riskParams, 'E2E_MOCK', '1d', compiled.strategy.name, 3);
		console.log(`  ✔ [Stage 4/8] Rolling Walk-Forward validation run completed. Windows: ${rollingResult.windows.length}`);

		// 5) Multi-Asset Walk-Forward check
		const multiResult = await runMultiAssetResearch(
			{ coins: ['E2E_MOCK', 'E2E_MOCK2'], intervals: ['1d'], strategyName: compiled.strategy.name, numWindows: 2 },
			platformConfig,
			riskParams
		);
		console.log(`  ✔ [Stage 5/8] Multi-Asset walk-forward cross-validation completed. Runs: ${multiResult.length}`);

		// 6) Monte Carlo Risk check
		const mc = runMonteCarlo(backtestResult.trades.map((t) => t.pnlPercent), platformConfig.initialCapital, {
			method: 'bootstrap',
			simulationsCount: 100,
			ruinThresholdPercent: 30,
		});
		console.log(`  ✔ [Stage 6/8] Monte Carlo simulation run completed. Risk of Ruin: ${mc.riskOfRuinPercent}%`);

		// 7) Portfolio Backtest simulation
		const timelineProvider = new CSVTimelineProvider();
		const candlesMap = new Map();
		candlesMap.set('E2E_MOCK', candles1);
		candlesMap.set('E2E_MOCK2', candles2);
		const alignedTimeline = timelineProvider.alignCandles(candlesMap);

		const strategiesMap = new Map();
		strategiesMap.set('E2E_MOCK', compiled.strategy);
		strategiesMap.set('E2E_MOCK2', createStrategyFromConfig(configJson, candles2).strategy);

		const portfolioResult = runPortfolioExecution(
			alignedTimeline,
			candlesMap,
			strategiesMap,
			new EqualWeightAllocation(),
			platformConfig,
			riskParams,
			{ maxPositions: 2, preventDoublePosition: true }
		);
		console.log(`  ✔ [Stage 7/8] Portfolio multi-position engine execution completed. Return: ${portfolioResult.totalReturn}%`);

		// 8) Alpha Discovery Pipeline
		const discovery = await runDiscoveryPipeline(['E2E_MOCK', 'E2E_MOCK2'], 4, '1d');
		console.log(`  ✔ [Stage 8/8] Alpha Discovery Pipeline successfully finished. Candidates: ${discovery.totalCandidates}`);

		// 9) Dashboard Server Verification
		const testServer = startDashboardServer(3005);
		const pingRes = await fetch('http://localhost:3005/api/reports');
		if (pingRes.ok) {
			console.log('  ✔ [Stage 9/9] Local Dashboard server successfully started and responded.');
		} else {
			throw new Error(`Dashboard server responded with status: ${pingRes.status}`);
		}
		testServer.close();

		console.log('═'.repeat(64));
		console.log('  🎉 E2E INTEGRATION VERIFICATION PASSED SUCCESSFULLY!');
		console.log('═'.repeat(64));

	} finally {
		if (existsSync(mockFile1)) unlinkSync(mockFile1);
		if (existsSync(mockFile2)) unlinkSync(mockFile2);
	}
}

// ─── Ana Giriş ──────────────────────────────────────────────────────────────

function printUsage(): void {
	console.log('');
	console.log('KRIPTOQUANT — Crypto Quant Research Platform');
	console.log('');
	console.log('Kullanım:');
	console.log('  npx tsx src/cli.ts <komut> [seçenekler]');
	console.log('');
	console.log('Komutlar:');
	console.log('  fetch         Tarihsel veri çek ve kaydet');
	console.log('  backtest      Strateji backtest\'i çalıştır');
	console.log('  sweep         Parametre tarama laboratuvarı');
	console.log('  walkforward   Walk-Forward Validation');
	console.log('  walkforward-rolling  Rolling Walk-Forward (multi-window)');
	console.log('  walkforward-multi  Multi-Asset Walk-Forward (cross-validation)');
	console.log('  validation-lab  Validation Lab (ablation & paired t-test)');
	console.log('  paper-trade   Paper Trading (simüle, para kullanılmaz)');
	console.log('  backtest-config  JSON strateji dosyası ile backtest çalıştır');
	console.log('  dashboard     Premium HTML Dashboard sunucusunu başlat');
	console.log('');
	console.log('Seçenekler:');
	console.log('  --config <yol>        JSON strateji dosyası yolu');
	console.log('  --coins <semboller>   Virgülle ayrılmış coinler (ör. BTCUSDT,ETHUSDT)');
	console.log('  --interval <aralık>   Mum aralığı (ör. 1d, 4h, 1h)');
	console.log('  --intervals <aralıklar> Virgülle ayrılmış aralıklar (ör. 4h,1d)');
	console.log('  --strategy <ad>       Strateji adı (ema-cross, donchian-breakout)');
	console.log('  --start-date <tarih>  Analiz başlangıç tarihi (ör. 2024-01-01)');
	console.log('  --end-date <tarih>    Analiz bitiş tarihi (ör. 2025-01-01)');
	console.log('');
	console.log('Örnekler:');
	console.log('  npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d');
	console.log('  npx tsx src/cli.ts backtest --strategy donchian-breakout --coin BTCUSDT');
	console.log('  npx tsx src/cli.ts sweep --coin BTCUSDT --interval 1d');
	console.log('  npx tsx src/cli.ts validation-lab --coins BTCUSDT,ETHUSDT --intervals 4h,1d');
	console.log('  npx tsx src/cli.ts walkforward-rolling --strategy donchian-breakout --coin BTCUSDT');
	console.log('  npx tsx src/cli.ts walkforward-multi --strategy donchian-breakout --coins BTCUSDT,ETHUSDT --intervals 4h,1d');
	console.log('  npx tsx src/cli.ts paper-trade --strategy donchian-breakout --coin BTCUSDT');
	console.log('');
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			coin: { type: 'string', default: 'BTCUSDT' },
			coins: { type: 'string' },
			interval: { type: 'string', default: platformConfig.defaultInterval },
			intervals: { type: 'string' },
			strategy: { type: 'string', default: 'sma-cross' },
			config: { type: 'string' },
			simulations: { type: 'string', default: '1000' },
			'mc-method': { type: 'string', default: 'bootstrap' },
			'ruin-pct': { type: 'string', default: '30' },
			allocation: { type: 'string', default: 'equal' },
			'risk-percent': { type: 'string', default: '1.0' },
			'max-positions': { type: 'string', default: '5' },
			candidates: { type: 'string', default: '20' },
			port: { type: 'string', default: '3000' },
			'start-date': { type: 'string' },
			'end-date': { type: 'string' },
			help: { type: 'boolean', short: 'h', default: false },
		},
		allowPositionals: true,
	});

	const command = positionals[0];

	if (values.help || !command) {
		printUsage();
		process.exit(0);
	}

	try {
		switch (command) {
			case 'fetch':
				await commandFetch(values.coin!, values.interval!);
				break;
			case 'backtest': {
				const mcOptions = {
					simulationsCount: parseInt(values.simulations ?? '1000', 10),
					method: (values['mc-method'] === 'shuffle' ? 'shuffle' : 'bootstrap') as 'bootstrap' | 'shuffle',
					ruinThresholdPercent: parseInt(values['ruin-pct'] ?? '30', 10),
				};
				await commandBacktest(values.strategy!, values.coin!, values.interval!, mcOptions);
				break;
			}
			case 'backtest-config': {
				const mcOptions = {
					simulationsCount: parseInt(values.simulations ?? '1000', 10),
					method: (values['mc-method'] === 'shuffle' ? 'shuffle' : 'bootstrap') as 'bootstrap' | 'shuffle',
					ruinThresholdPercent: parseInt(values['ruin-pct'] ?? '30', 10),
				};
				await commandBacktestConfig(values.config!, values.coin!, values.interval!, mcOptions);
				break;
			}
			case 'portfolio-backtest': {
				const opts = {
					allocation: (values.allocation === 'risk-budget' ? 'risk-budget' : 'equal') as 'equal' | 'risk-budget',
					riskPercent: parseFloat(values['risk-percent'] ?? '1.0'),
					maxPositions: parseInt(values['max-positions'] ?? '5', 10),
					simulationsCount: parseInt(values.simulations ?? '1000', 10),
					mcMethod: (values['mc-method'] === 'shuffle' ? 'shuffle' : 'bootstrap') as 'bootstrap' | 'shuffle',
					ruinPct: parseInt(values['ruin-pct'] ?? '30', 10),
				};
				const strat = values.config || values.strategy || 'sma-cross';
				const coins = values.coins || values.coin || 'BTCUSDT';
				await commandPortfolioBacktest(strat, coins, values.interval!, opts);
				break;
			}
			case 'alpha-discover': {
				const coins = values.coins || values.coin || 'BTCUSDT,ETHUSDT';
				const count = parseInt(values.candidates ?? '20', 10);
				await commandAlphaDiscover(coins, count, values.interval!);
				break;
			}
			case 'sweep':
				await commandSweep(values.coin!, values.interval!);
				break;
			case 'walkforward':
				await commandWalkForward(values.strategy!, values.coin!, values.interval!);
				break;
			case 'walkforward-rolling':
				await commandRollingWalkForward(values.strategy!, values.coin!, values.interval!);
				break;
			case 'walkforward-multi':
				await commandMultiAsset(values.strategy!, values.coins, values.intervals);
				break;
			case 'paper-trade':
				await commandPaperTrade(values.strategy!, values.coin!, values.interval!);
				break;
			case 'verify-e2e':
				await commandVerifyE2e();
				break;
			case 'validation-lab':
				await commandValidationLab(values.coins, values.intervals, values['start-date'], values['end-date']);
				break;
			case 'dashboard': {
				const portNum = parseInt(values.port ?? '3000', 10);
				startDashboardServer(portNum);
				break;
			}
			default:
				logError(`Bilinmeyen komut: ${command}`);
				printUsage();
				process.exit(1);
		}
	} catch (error) {
		logError(`Hata: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}

main();
