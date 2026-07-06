import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBacktest } from '../src/research/backtester.js';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import type { Candle } from '../src/core/types.js';

// Load historical data
const dataPath = join(process.cwd(), 'data', 'raw', 'BTCUSDT_4h.json');
const candles: Candle[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

const platformConfig = {
	initialCapital: 10000,
	commissionPercent: 0.1,
	slippagePercent: 0.05,
	makerFee: 0.0002,
	takerFee: 0.0004,
	slippageModel: 'linear' as const
};

const strategy = createEmaCrossStrategy(9, 21);

console.log('=== PARAMETER SENSITIVITY TESTING ===');

const parameters = [
	{ sl: 0.01, tp: 0.03, label: 'Tight SL/TP (1% SL / 3% TP)' },
	{ sl: 0.05, tp: 0.15, label: 'Medium SL/TP (5% SL / 15% TP)' },
	{ sl: 0.10, tp: 0.30, label: 'Wide SL/TP (10% SL / 30% TP)' },
	{ sl: 5.0, tp: 15.0, label: 'Percentage values as integers (5% SL / 15% TP - Auto-divided)' }
];

for (const p of parameters) {
	const riskParams = {
		maxPositionPercent: 20,
		maxDailyLossPercent: 5,
		maxOrderValue: 2000,
		stopLossAtrMultiplier: 2,
		stopLossPercent: p.sl,
		takeProfitPercent: p.tp
	};

	const result = runBacktest(strategy, candles, platformConfig, riskParams, 'BTCUSDT');
	console.log(`\nConfig: ${p.label}`);
	console.log(`- Total Trades    : ${result.totalTrades}`);
	console.log(`- Winning Trades  : ${result.winningTrades}`);
	console.log(`- Losing Trades   : ${result.losingTrades}`);
	console.log(`- Total Return    : ${result.totalReturn}%`);
	console.log(`- Final Capital   : $${result.finalCapital}`);
	console.log(`- Max Drawdown    : ${result.maxDrawdown}%`);
}
