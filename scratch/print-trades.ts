import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExecution } from '../src/execution/engine.js';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import { SimulatedBroker } from '../src/execution/simulated-broker.js';
import type { Candle } from '../src/core/types.js';

const dataPath = join(process.cwd(), 'data', 'raw', 'ETHUSDT_1d.json');
const candles: Candle[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

const platformConfig = {
	initialCapital: 10000,
	commissionPercent: 0.1,
	slippagePercent: 0.05,
	makerFee: 0.0002,
	takerFee: 0.0004,
	slippageModel: 'linear' as const
};

const riskParams = {
	maxPositionPercent: 20,
	maxDailyLossPercent: 5,
	maxOrderValue: 2000,
	stopLossAtrMultiplier: 2,
	stopLossPercent: 0.05,
	takeProfitPercent: 0.15
};

const strategy = createEmaCrossStrategy(9, 21);
const broker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);

const relaxedDefaults = {
	filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
	confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
};

const result = runExecution(candles, strategy, broker, platformConfig, riskParams, 'ETHUSDT', relaxedDefaults);

console.log('=== TRADES JOURNAL ===');
console.log(`Initial Capital: $${result.initialCapital}`);
console.log(`Final Capital:   $${result.finalCapital}`);
console.log(`Total Return:    ${result.totalReturn}%`);
console.log(`Total Trades:    ${result.totalTrades}\n`);

result.trades.forEach((trade, index) => {
	console.log(`Trade #${index + 1}:`);
	console.log(`  Asset:       ${trade.asset}`);
	console.log(`  Entry:       Date: ${new Date(trade.entryOrder.timestamp).toISOString().slice(0, 10)} | Price: $${trade.entryOrder.price.toFixed(2)} | Qty: ${trade.entryOrder.quantity.toFixed(4)} | Value: $${trade.entryOrder.value.toFixed(2)}`);
	console.log(`  Exit:        Date: ${new Date(trade.exitOrder.timestamp).toISOString().slice(0, 10)} | Price: $${trade.exitOrder.price.toFixed(2)} | Qty: ${trade.exitOrder.quantity.toFixed(4)} | Value: $${trade.exitOrder.value.toFixed(2)}`);
	console.log(`  PnL (Net):   $${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(2)}%)`);
	console.log(`  Reason:      ${trade.exitReason}`);
	console.log(`  Commission:  $${trade.commission.toFixed(2)}`);
	console.log('----------------------------------------------------');
});
