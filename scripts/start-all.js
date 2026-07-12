// ============================================================================
// KRIPTOQUANT — Canlı kadro için "running" state dosyaları üretir.
// Dashboard sunucusu açılışta bu dosyaları görüp motorları auto-resume eder.
// Kullanım: node scripts/start-all.js && pm2 restart kriptoquant-bot
// DİKKAT: Mevcut state dosyalarının ÜZERİNE YAZAR (kasa 10.000'e sıfırlanır).
// Devam eden bir test varsa çalıştırma; sadece temiz başlangıç için kullan.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Canlı test kadrosu — src/live/live-engine.ts içindeki LIVE_STRATEGY_ROSTER ile aynı
const roster = [
	{ name: 'a2-v2', interval: '15m' },
	{ name: 'vwap-reversion', interval: '15m' },
	{ name: 'donchian-breakout', interval: '4h' },
	{ name: 'ema-cross', interval: '4h' },
	{ name: 'random', interval: '15m' },
	{ name: 'momentum-burst', interval: '15m' },
];

const coins = [
	'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
	'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT',
	'APTUSDT', 'DOTUSDT', 'LTCUSDT', 'POLUSDT',
	'ARBUSDT', 'OPUSDT',
];

const resultsDir = join(process.cwd(), 'results');
if (!existsSync(resultsDir)) {
	mkdirSync(resultsDir, { recursive: true });
}

console.log(`Generating ${roster.length} live state files for auto-resume...`);

for (const { name, interval } of roster) {
	const statePath = join(resultsDir, `live_paper_state_${name}_${interval}.json`);

	const state = {
		engineStatus: 'running',
		strategyPath: name,
		interval,
		coins,
		startTime: new Date().toISOString(),
		uptime: 0,
		currentEquity: 10000,
		cash: 10000,
		unrealizedPnL: 0,
		realizedPnL: 0,
		activePositions: [],
		pendingSignals: [],
		closedTrades: [],
		equityCurveLive: [{ time: new Date().toLocaleTimeString(), equity: 10000 }],
		heartbeat: new Date().toISOString(),
		lastCandleTime: '',
	};

	writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
	console.log(`Created state file: ${statePath}`);
}

console.log(`Done. ${roster.length} strategies armed. Next: pm2 restart kriptoquant-bot`);
