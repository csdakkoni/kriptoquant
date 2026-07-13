// ============================================================================
// KRIPTOQUANT — CLI Entry Point
// ============================================================================
// KriptoQuant is an autonomous falsification engine for financial markets.
// Kullanım:
//   npx tsx src/cli.ts organism       ← Start the Assumption Killer
//   npx tsx src/cli.ts live           ← Start live trading engine
//   npx tsx src/cli.ts dashboard      ← Start web dashboard
//   npx tsx src/cli.ts fetch          ← Fetch data from Binance
// ============================================================================

import { parseArgs } from 'node:util';
import type { RiskConfig } from './core/types.js';
import { log, logError } from './core/utils.js';
import { fetchAndStore } from './data/fetcher.js';
import { startDashboardServer } from './dashboard/server.js';
import { startExecutionEngine } from './live/live-engine.js';
import { startAssumptionKiller } from './organism/assumption-killer.js';

// Konfigürasyonları yükle
import riskConfig from '../config/risk.json' with { type: 'json' };
const riskParams = riskConfig as RiskConfig;

// ─── Komutlar ────────────────────────────────────────────────────────────────

async function commandFetch(coin: string, interval: string): Promise<void> {
	log(`Veri çekme başlıyor: ${coin} (${interval})`);
	const candles = await fetchAndStore(coin, interval, { force: true });
	log(`Tamamlandı: ${candles.length} mum verisi kaydedildi.`);
}

// ─── Yardım ──────────────────────────────────────────────────────────────────

function printUsage(): void {
	console.log(`
╔══════════════════════════════════════════════════════════════╗
║  KriptoQuant — Autonomous Falsification Engine              ║
║  "Science progresses by trying to prove itself wrong."      ║
╚══════════════════════════════════════════════════════════════╝

Komutlar:
  organism      🔬 Assumption Killer — Varsayım yanlışlama motoru
  live          ⚡ Canlı trading motoru
  dashboard     📊 Web dashboard
  fetch         📥 Binance'den veri çek

Örnekler:
  npx tsx src/cli.ts organism
  npx tsx src/cli.ts live --coins BTCUSDT,ETHUSDT --interval 15m --strategy a2-v2
  npx tsx src/cli.ts dashboard --port 3000
  npx tsx src/cli.ts fetch --coin BTCUSDT --interval 15m
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			coin: { type: 'string' },
			coins: { type: 'string' },
			interval: { type: 'string' },
			strategy: { type: 'string' },
			port: { type: 'string' },
			help: { type: 'boolean', short: 'h' },
		},
	});

	const command = positionals[0];

	if (!command || values.help) {
		printUsage();
		process.exit(command ? 0 : 1);
	}

	try {
		switch (command) {
			case 'organism':
				await startAssumptionKiller();
				break;

			case 'fetch':
				await commandFetch(values.coin ?? 'BTCUSDT', values.interval ?? '15m');
				break;

			case 'live': {
				const coins = (values.coins ?? 'BTCUSDT').split(',');
				const interval = values.interval ?? '15m';
				const strategy = values.strategy ?? 'a2-v2';
				await startExecutionEngine(coins, interval, strategy);
				break;
			}

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
