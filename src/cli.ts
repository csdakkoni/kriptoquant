// ============================================================================
// KRIPTOQUANT — CLI Entry Point
// ============================================================================
// KriptoQuant is an autonomous falsification engine for financial markets.
// Kullanım:
//   npx tsx src/cli.ts organism       ← Start the Assumption Killer
//   npx tsx src/cli.ts dashboard      ← Start web dashboard
// ============================================================================

import { parseArgs } from 'node:util';
import { log, logError } from './core/utils.js';
import { startDashboardServer } from './dashboard/server.js';
import { startAssumptionKiller } from './organism/assumption-killer.js';

// ─── Yardım ──────────────────────────────────────────────────────────────────

function printUsage(): void {
	console.log(`
╔══════════════════════════════════════════════════════════════╗
║  KriptoQuant — Autonomous Falsification Engine              ║
║  "Science progresses by trying to prove itself wrong."      ║
╚══════════════════════════════════════════════════════════════╝

Komutlar:
  organism      🔬 Assumption Killer — Varsayım yanlışlama motoru
  dashboard     📊 Web dashboard

Örnekler:
  npx tsx src/cli.ts organism
  npx tsx src/cli.ts dashboard --port 3008
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
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
