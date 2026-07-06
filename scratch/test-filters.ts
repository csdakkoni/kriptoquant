import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExecution } from '../src/execution/engine.js';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import { SimulatedBroker } from '../src/execution/simulated-broker.js';
import type { Candle } from '../src/core/types.js';

// Load historical daily data for BTCUSDT
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

console.log('=== COMPARING STRICT VS RELAXED FILTERS ===');

// 1. Strict Filters (Default)
const strictDefaults = {
	filters: { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 },
	confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: 70 }
};
const strictResult = runExecution(candles, strategy, broker, platformConfig, riskParams, 'ETHUSDT', strictDefaults);
console.log('\n[1] STRICT FILTERS (ADX >= 20, RVOL >= 1.5):');
console.log(`- Total Signals   : ${strictResult.filterStats?.totalSignals}`);
console.log(`- Accepted Trades : ${strictResult.totalTrades}`);
console.log(`- Total Return    : ${strictResult.totalReturn}%`);

// 2. Relaxed Filters (Disabled)
const relaxedDefaults = {
	filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
	confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
};
const relaxedResult = runExecution(candles, strategy, broker, platformConfig, riskParams, 'ETHUSDT', relaxedDefaults);
console.log('\n[2] RELAXED FILTERS (ADX >= 0, RVOL >= 0):');
console.log(`- Total Signals   : ${relaxedResult.filterStats?.totalSignals}`);
console.log(`- Accepted Trades : ${relaxedResult.totalTrades}`);
console.log(`- Total Return    : ${relaxedResult.totalReturn}%`);
