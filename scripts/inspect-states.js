import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const resultsDir = join(process.cwd(), 'results');
if (!existsSync(resultsDir)) {
	console.error('Results directory not found.');
	process.exit(1);
}

const files = readdirSync(resultsDir).filter(f => f.startsWith('live_paper_state_') && f.endsWith('.json'));

console.log(`Found ${files.length} live state files:`);
console.log('------------------------------------------------------------');
console.log('Strategy - Interval | Status | Cash | Equity | Realized | Unrealized | Positions | Trades');
console.log('------------------------------------------------------------');

for (const file of files) {
	try {
		const raw = readFileSync(join(resultsDir, file), 'utf-8');
		const state = JSON.parse(raw);
		const name = file.replace('live_paper_state_', '').replace('.json', '');
		console.log(
			`${name.padEnd(25)} | ${state.engineStatus.padEnd(7)} | $${Math.round(state.cash)} | $${Math.round(state.currentEquity)} | $${Math.round(state.realizedPnL)} | $${Math.round(state.unrealizedPnL)} | ${state.activePositions?.length || 0} | ${state.closedTrades?.length || 0}`
		);
	} catch (e) {
		console.error(`Failed to read ${file}:`, e.message);
	}
}
