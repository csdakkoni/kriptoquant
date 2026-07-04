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
	const result = runBacktest(strategy, candles, platformConfig, riskParams, coin, strategyDefaults);

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
	const result = runBacktest(strategy, candles, platformConfig, riskParams, coin, strategyDefaults);

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
			case 'backtest':
				await commandBacktest(values.strategy!, values.coin!, values.interval!);
				break;
			case 'backtest-config':
				await commandBacktestConfig(values.config!, values.coin!, values.interval!);
				break;
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
