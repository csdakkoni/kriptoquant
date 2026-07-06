import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import { runExecution } from '../src/execution/engine.js';
import { SimulatedBroker } from '../src/execution/simulated-broker.js';
import type { Candle } from '../src/core/types.js';

const dataPath = join(process.cwd(), 'data', 'raw', 'BTCUSDT_1d.json');
const candles: Candle[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

const platformConfig = {
	initialCapital: 10000,
	commissionPercent: 0.1,
	slippagePercent: 0.05,
	makerFee: 0.0002,
	takerFee: 0.0004,
	slippageModel: 'linear' as const
};

const riskConfig = {
	maxPositionPercent: 20,
	maxDailyLossPercent: 5,
	maxOrderValue: 2000,
	stopLossAtrMultiplier: 2,
	stopLossPercent: 0.05,
	takeProfitPercent: 0.15
};

const strategy = createEmaCrossStrategy(9, 21);
const broker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);

console.log('=== ABLATION STUDY: FILTER STAGES (BTCUSDT 1d) ===');
console.log('| Filter Stage | Trades | Win Rate % | Profit Factor | Sharpe | Return % |');
console.log('| ------------ | ------ | ---------- | ------------- | ------ | -------- |');

const runs = [
	{
		label: 'Raw Strategy (No Filters)',
		filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
		confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
	},
	{
		label: 'Strategy + ADX Only (ADX >= 20)',
		filters: { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 0 },
		confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
	},
	{
		label: 'Strategy + RVOL Only (RVOL >= 1.5)',
		filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 1.5 },
		confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
	},
	{
		label: 'Strategy + BOTH (ADX >= 20 & RVOL >= 1.5)',
		filters: { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 },
		confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
	}
];

for (const run of runs) {
	const result = runExecution(candles, strategy, broker, platformConfig, riskConfig, 'BTCUSDT', run);
	const pfStr = result.profitFactor === Infinity ? 'Inf' : result.profitFactor.toFixed(2);
	console.log(`| ${run.label.padEnd(35)} | ${result.totalTrades.toString().padEnd(6)} | ${result.winRate.toFixed(1)}%     | ${pfStr.padEnd(13)} | ${result.sharpeRatio.toFixed(2)}  | ${result.totalReturn.toFixed(2)}%  |`);
}
