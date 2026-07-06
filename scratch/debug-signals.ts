import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ema } from '../src/core/indicators/macd.js';
import { atr } from '../src/core/indicators/atr.js';
import { adx } from '../src/core/indicators/adx.js';
import { sma } from '../src/core/indicators/sma.js';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import { createFilterEngine } from '../src/research/filters/filter-engine.js';
import type { Candle } from '../src/core/types.js';

const dataPath = join(process.cwd(), 'data', 'raw', 'BTCUSDT_1d.json');
const candles: Candle[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

const strategy = createEmaCrossStrategy(9, 21);
const signals = strategy.evaluate(candles);
const buySignals = signals.filter(s => s.side === 'BUY');

const filterConfig = { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 };
const filterEngine = createFilterEngine(candles, filterConfig);

const adxPeriod = 14;
const adxResult = adx(candles, adxPeriod);

const rvolLookback = 20;
const volumes = candles.map((c) => c.volume);
const volMa = sma(volumes, rvolLookback);
const rvolValues = volumes.map((v, i) =>
	!Number.isNaN(volMa[i]) && volMa[i] > 0 ? v / volMa[i] : NaN
);

const timestampToIndex = new Map<number, number>();
for (let i = 0; i < candles.length; i++) {
	timestampToIndex.set(candles[i].openTime, i);
}

console.log('=== BTCUSDT DAILY BUY SIGNALS TRACE ===\n');

buySignals.forEach((signal, index) => {
	const idx = timestampToIndex.get(signal.timestamp) ?? -1;
	const dateStr = new Date(signal.timestamp).toISOString().slice(0, 10);
	
	const valAdx = adxResult.adx[idx];
	const valRvol = rvolValues[idx];
	const rawVol = volumes[idx];
	const rawVolMa = volMa[idx];

	const verdict = filterEngine.evaluate(idx);

	console.log(`BUY Signal #${index + 1}:`);
	console.log(`  Date        : ${dateStr}`);
	console.log(`  Candle Index: ${idx}`);
	console.log(`  Close Price : $${signal.price.toFixed(2)}`);
	console.log(`  ADX         : ${valAdx !== undefined && !Number.isNaN(valAdx) ? valAdx.toFixed(2) : 'NaN'} (Threshold: ${filterConfig.adxVetoThreshold})`);
	console.log(`  Volume      : ${rawVol.toFixed(2)}`);
	console.log(`  Volume SMA  : ${rawVolMa !== undefined && !Number.isNaN(rawVolMa) ? rawVolMa.toFixed(2) : 'NaN'}`);
	console.log(`  RVOL        : ${valRvol !== undefined && !Number.isNaN(valRvol) ? valRvol.toFixed(2) : 'NaN'} (Threshold: ${filterConfig.rvolVetoThreshold})`);
	console.log(`  Verdict     : ${verdict.passed ? 'PASS' : 'FAIL'}`);
	if (!verdict.passed) {
		console.log(`  Reasons     : ${verdict.reasons.join(', ')}`);
	}
	console.log('----------------------------------------------------');
});
