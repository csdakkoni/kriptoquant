// ============================================================================
// KRIPTOQUANT — CLI Entry Point (Sprint 7)
// ============================================================================
// Platformun tek giriş noktası. Her şey terminalden başlar.
// Kullanım:
//   npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d
//   npx tsx src/cli.ts backtest --strategy ema-cross --coin BTCUSDT --interval 1d
//   npx tsx src/cli.ts sweep --coin BTCUSDT --interval 1d
// ============================================================================

import { parseArgs } from 'node:util';
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
import { DEFAULT_SWEEP } from './research/experiments/runner.js';
import { runSweep, printLeaderboard, printMetadata, exportSweepCSV, exportMetadataJSON } from './research/experiments/sweep.js';

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
		logError('Mevcut stratejiler: sma-cross, ema-cross');
		process.exit(1);
	}

	let candles = loadCandles(coin, interval);
	if (candles.length === 0) {
		log('Yerel veri bulunamadı, API\'den çekiliyor...');
		candles = await fetchAndStore(coin, interval);
	}

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

async function commandSweep(coin: string, interval: string): Promise<void> {
	let candles = loadCandles(coin, interval);
	if (candles.length === 0) {
		log('Yerel veri bulunamadı, API\'den çekiliyor...');
		candles = await fetchAndStore(coin, interval);
	}

	if (candles.length === 0) {
		logError(`${coin} için veri bulunamadı.`);
		process.exit(1);
	}

	log(`${coin} verisi yüklendi: ${candles.length} mum`);

	const { results, metadata } = await runSweep(
		candles, DEFAULT_SWEEP, platformConfig, riskParams, coin, interval,
	);

	printLeaderboard(results);
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

// ─── Ana Giriş ──────────────────────────────────────────────────────────────

function printUsage(): void {
	console.log('');
	console.log('KRIPTOQUANT — Crypto Quant Research Platform');
	console.log('');
	console.log('Kullanım:');
	console.log('  npx tsx src/cli.ts <komut> [seçenekler]');
	console.log('');
	console.log('Komutlar:');
	console.log('  fetch     Tarihsel veri çek ve kaydet');
	console.log('  backtest  Strateji backtest\'i çalıştır');
	console.log('  sweep     Parametre tarama laboratuvarı');
	console.log('');
	console.log('Seçenekler:');
	console.log('  --coin <sembol>       Coin sembolü (ör. BTCUSDT)');
	console.log('  --interval <aralık>   Mum aralığı (ör. 1d, 4h, 1h)');
	console.log('  --strategy <ad>       Strateji adı (sma-cross, ema-cross)');
	console.log('');
	console.log('Örnekler:');
	console.log('  npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d');
	console.log('  npx tsx src/cli.ts backtest --strategy ema-cross --coin BTCUSDT');
	console.log('  npx tsx src/cli.ts sweep --coin BTCUSDT --interval 1d');
	console.log('');
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: {
			coin: { type: 'string', default: 'BTCUSDT' },
			interval: { type: 'string', default: platformConfig.defaultInterval },
			strategy: { type: 'string', default: 'sma-cross' },
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
			case 'sweep':
				await commandSweep(values.coin!, values.interval!);
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
