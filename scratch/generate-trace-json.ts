import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ema } from '../src/core/indicators/macd.js';
import { atr } from '../src/core/indicators/atr.js';
import { adx } from '../src/core/indicators/adx.js';
import { sma } from '../src/core/indicators/sma.js';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import { createFilterEngine } from '../src/research/filters/filter-engine.js';
import { calculateConfidence } from '../src/research/confidence/confidence-engine.js';
import { evaluateRisk } from '../src/core/risk/risk-manager.js';
import { Portfolio } from '../src/execution/portfolio.js';
import type { Candle, Signal } from '../src/core/types.js';

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

const filterConfig = { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 };
const confidenceConfig = { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: 70 };

const strategy = createEmaCrossStrategy(9, 21);
const portfolio = new Portfolio(platformConfig.initialCapital);

const signals = strategy.evaluate(candles);
const buySignals = signals.filter(s => s.side === 'BUY');

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

const traceList: any[] = [];

buySignals.forEach((signal) => {
	const idx = timestampToIndex.get(signal.timestamp) ?? -1;
	if (idx < 0) return;

	const dateStr = new Date(signal.timestamp).toISOString().slice(0, 10);
	const valAdx = adxResult.adx[idx];
	const valRvol = rvolValues[idx];

	const fVerdict = filterEngine.evaluate(idx);
	
	let confidenceScore = 0;
	let cPassed = false;
	let cBreakdown = 'N/A';
	let rApproved = false;
	let rReason = 'N/A';
	let status = 'REJECTED_BY_FILTER';

	if (fVerdict.passed) {
		const cVerdict = calculateConfidence(valAdx, valRvol, confidenceConfig);
		confidenceScore = cVerdict.score;
		cPassed = cVerdict.passed;
		cBreakdown = cVerdict.breakdown;

		if (!cVerdict.passed) {
			status = 'REJECTED_BY_CONFIDENCE';
		} else {
			const rVerdict = evaluateRisk(signal, portfolio.getCapital(), portfolio.getDailyPnl(), riskConfig);
			rApproved = rVerdict.approved;
			rReason = rVerdict.reason;
			if (!rVerdict.approved) {
				status = 'REJECTED_BY_RISK';
			} else {
				status = 'APPROVED';
			}
		}
	}

	traceList.push({
		date: dateStr,
		timestamp: signal.timestamp,
		price: signal.price,
		adx: valAdx !== undefined && !Number.isNaN(valAdx) ? Number(valAdx.toFixed(4)) : null,
		rvol: valRvol !== undefined && !Number.isNaN(valRvol) ? Number(valRvol.toFixed(4)) : null,
		filterPassed: fVerdict.passed,
		filterReasons: fVerdict.reasons,
		confidenceScore,
		confidencePassed: cPassed,
		confidenceBreakdown: cBreakdown,
		riskApproved: rApproved,
		riskReason: rReason,
		finalStatus: status
	});
});

const outputPath = join(process.cwd(), 'results', 'btc_signals_trace.json');
writeFileSync(outputPath, JSON.stringify(traceList, null, 2), 'utf-8');
console.log(`Trace file generated successfully at: ${outputPath}`);
