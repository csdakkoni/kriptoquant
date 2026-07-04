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
import { readFileSync } from 'node:fs';
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
		logError('Mevcut stratejiler: sma-cross, ema-cross, donchian-breakout');
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
	console.log(`\n  💾 CSV : ${csvPath}`);

	const jsonPath = `results/rolling_summary_${coin}_${interval}_${timestamp}.json`;
	exportRollingSummaryJSON(result, jsonPath);
	console.log(`  🔬 JSON: ${jsonPath}`);
}

async function commandPaperTrade(strategyName: string, coin: string, interval: string): Promise<void> {
	const provider = new CSVProvider();
	const candles = await provider.getHistory(coin, interval);

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`${coin} verisi yüklendi: ${candles.length} mum`);

	const strategy = resolveStrategy(strategyName);
	if (!strategy) {
		logError(`Bilinmeyen strateji: ${strategyName}`);
		logError('Mevcut stratejiler: sma-cross, ema-cross, donchian-breakout');
		process.exit(1);
	}
	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const logPath = `results/paper_trades_${strategy.name}_${coin}_${timestamp}.csv`;

	const broker = new PaperBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);
	const logger = new CSVTradeLogger(logPath);
	const result = runExecution(candles, strategy, broker, platformConfig, riskParams, coin, strategyDefaults, logger);

	printReport(result);

	console.log('');
	console.log(`  📋 Paper Trade Log: ${logPath}`);
	console.log(`  📊 Fills: ${broker.getFills().length}`);
	console.log(`  🏷️  Mode: PAPER (para kullanılmadı)`);
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
	console.log('  paper-trade   Paper Trading (simüle, para kullanılmaz)');
	console.log('  backtest-config  JSON strateji dosyası ile backtest çalıştır');
	console.log('');
	console.log('Seçenekler:');
	console.log('  --config <yol>        JSON strateji dosyası yolu');
	console.log('  --coin <sembol>       Coin sembolü (ör. BTCUSDT)');
	console.log('  --coins <semboller>   Virgülle ayrılmış coinler (ör. BTCUSDT,ETHUSDT)');
	console.log('  --interval <aralık>   Mum aralığı (ör. 1d, 4h, 1h)');
	console.log('  --intervals <aralıklar> Virgülle ayrılmış aralıklar (ör. 4h,1d)');
	console.log('  --strategy <ad>       Strateji adı (ema-cross, donchian-breakout)');
	console.log('');
	console.log('Örnekler:');
	console.log('  npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d');
	console.log('  npx tsx src/cli.ts backtest --strategy donchian-breakout --coin BTCUSDT');
	console.log('  npx tsx src/cli.ts sweep --coin BTCUSDT --interval 1d');
	console.log('  npx tsx src/cli.ts walkforward --strategy donchian-breakout --coin BTCUSDT');
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
