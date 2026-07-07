import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const strategies = ['consensus', 'a1', 'a2', 'donchian-breakout', 'ema-cross', 'supertrend', 'bollinger-bands', 'trend-pullback'];
const intervals = ['15m', '1h', '4h'];
const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];

const resultsDir = join(process.cwd(), 'results');
if (!existsSync(resultsDir)) {
	mkdirSync(resultsDir, { recursive: true });
}

console.log(`Starting generation of 24 live state files for auto-resume...`);

for (const strat of strategies) {
	for (const interval of intervals) {
		const statePath = join(resultsDir, `live_paper_state_${strat}_${interval}.json`);
		
		const state = {
			engineStatus: 'running',
			strategyPath: strat,
			interval: interval,
			coins: coins,
			mlVeto: false,
			startTime: new Date().toISOString(),
			uptime: 0,
			currentEquity: 10000,
			cash: 10000,
			unrealizedPnL: 0,
			realizedPnL: 0,
			activePositions: [],
			pendingSignals: [],
			closedTrades: [],
			equityCurveLive: [
				{ time: new Date().toLocaleTimeString(), equity: 10000 }
			],
			heartbeat: new Date().toISOString(),
			lastCandleTime: ''
		};

		writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
		console.log(`Created state file: ${statePath}`);
	}
}

console.log('Successfully generated all 32 configuration states. Next: PM2 restart kriptoquant-bot!');
