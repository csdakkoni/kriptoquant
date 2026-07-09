import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const resultsDir = join(process.cwd(), 'results');
if (!existsSync(resultsDir)) {
	console.error('Results directory not found.');
	process.exit(1);
}

const files = readdirSync(resultsDir).filter(f => f.startsWith('live_paper_state_') && f.endsWith('.json'));
const closedTrades = [];

for (const file of files) {
	try {
		const raw = readFileSync(join(resultsDir, file), 'utf-8');
		const state = JSON.parse(raw);
		const strategyName = file.replace('live_paper_state_', '').replace('.json', '');

		if (state.closedTrades && Array.isArray(state.closedTrades)) {
			for (const trade of state.closedTrades) {
				closedTrades.push({
					strategy: strategyName,
					coin: trade.coin,
					entryTime: trade.entryTime,
					exitTime: trade.exitTime,
					entryPrice: trade.entryPrice,
					exitPrice: trade.exitPrice,
					quantity: trade.quantity || 0,
					pnlPercent: trade.realizedPnLPercent || 0,
					pnlUsdt: trade.realizedPnLUsdt || 0,
					reason: trade.exitReason,
					durationSeconds: trade.holdingDurationSeconds || 0
				});
			}
		}
	} catch (e) {
		console.error(`Failed to read ${file}:`, e.message);
	}
}

if (closedTrades.length === 0) {
	console.log('No closed trades found to export.');
	process.exit(0);
}

// Sort trades by exit time (newest first)
closedTrades.sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());

// Generate CSV content
const headers = ['Strategy', 'Coin', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Quantity', 'PnL %', 'PnL $', 'Exit Reason', 'Duration (Seconds)'];
const csvRows = [headers.join(',')];

for (const t of closedTrades) {
	const row = [
		t.strategy,
		t.coin,
		t.entryTime,
		t.exitTime,
		t.entryPrice,
		t.exitPrice,
		t.quantity,
		t.pnlPercent.toFixed(4),
		t.pnlUsdt.toFixed(2),
		t.reason,
		t.durationSeconds
	];
	// Escape values if necessary (none of these fields contain commas usually, but to be safe)
	csvRows.push(row.map(val => `"${val}"`).join(','));
}

const outputPath = join(resultsDir, 'all_live_closed_trades.csv');
writeFileSync(outputPath, csvRows.join('\n'), 'utf-8');

console.log(`\n================================================================================`);
console.log(`✅ SUCCESS: Exported ${closedTrades.length} trades to:`);
console.log(`   ${outputPath}`);
console.log(`================================================================================\n`);
