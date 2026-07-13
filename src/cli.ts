// ============================================================================
// KRIPTOQUANT — CLI Entry Point
// ============================================================================
// Platformun tek giriş noktası.
// Kullanım:
//   npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d
//   npx tsx src/cli.ts live --coins BTCUSDT,ETHUSDT --interval 15m --strategy a2-v2
//   npx tsx src/cli.ts dashboard --port 3000
// ============================================================================

import { parseArgs } from 'node:util';
import type { RiskConfig } from './core/types.js';
import { log, logError } from './core/utils.js';
import { fetchAndStore } from './data/fetcher.js';
import { startDashboardServer } from './dashboard/server.js';
import { startExecutionEngine } from './live/live-engine.js';

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
║                    KriptoQuant CLI                          ║
╚══════════════════════════════════════════════════════════════╝

Komutlar:
  fetch         Binance'den veri çek
  live          Canlı trading motoru başlat
  dashboard     Web dashboard başlat

Örnekler:
  npx tsx src/cli.ts fetch --coin BTCUSDT --interval 15m
  npx tsx src/cli.ts live --coins BTCUSDT,ETHUSDT --interval 15m --strategy a2-v2
  npx tsx src/cli.ts dashboard --port 3000

Parametreler:
  --coin        Tek coin (fetch için)
  --coins       Virgülle ayrılmış coin listesi (live için)
  --interval    Zaman dilimi (1m, 5m, 15m, 1h, 4h, 1d)
  --strategy    Strateji adı (a2-v2, ema-cross, donchian-breakout, vwap-reversion, random, momentum-burst, swing-dip, donchian-short)
  --port        Dashboard portu (varsayılan: 3000)
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
