import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ema } from '../src/core/indicators/macd.js';
import { atr } from '../src/core/indicators/atr.js';
import { adx } from '../src/core/indicators/adx.js';
import { sma } from '../src/core/indicators/sma.js';
import { createEmaCrossStrategy } from '../src/research/strategies/ema-cross/index.js';
import { createFilterEngine } from '../src/research/filters/filter-engine.js';
import { calculateConfidence } from '../src/research/confidence/confidence-engine.js';
import { evaluateRisk } from '../src/core/risk/risk-manager.js';
import { SimulatedBroker } from '../src/execution/simulated-broker.js';
import { Portfolio } from '../src/execution/portfolio.js';
import { AtrStopRule } from '../src/execution/stop-rule.js';
import type { Candle, Signal } from '../src/core/types.js';

const round = (val: number, decimals: number = 2) => Number(val.toFixed(decimals));

function runWaterfall(coin: string, interval: string) {
	const dataPath = join(process.cwd(), 'data', 'raw', `${coin}_${interval}.json`);
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
	const broker = new SimulatedBroker(platformConfig.commissionPercent, platformConfig.slippagePercent);
	const portfolio = new Portfolio(platformConfig.initialCapital);
	const stopRule = new AtrStopRule(riskConfig.stopLossAtrMultiplier);

	const atrValues = atr(candles, 14);
	const signals = strategy.evaluate(candles);

	const timestampToIndex = new Map<number, number>();
	for (let i = 0; i < candles.length; i++) {
		timestampToIndex.set(candles[i].openTime, i);
	}

	const filterEngine = createFilterEngine(candles, filterConfig);

	let totalSignals = signals.length;
	let buySignals = signals.filter(s => s.side === 'BUY').length;
	let sellSignals = signals.filter(s => s.side === 'SELL').length;

	let adxRejections = 0;
	let rvolRejections = 0;
	let bothRejections = 0;
	let filterPassed = 0;

	let confidenceRejections = 0;
	let confidencePassed = 0;

	let riskRejections = 0;
	let riskApproved = 0;

	let positionsOpened = 0;
	let positionsClosed = 0;

	let exitSlPercent = 0;
	let exitTpPercent = 0;
	let exitAtrStop = 0;
	let exitForce = 0;
	let exitStrategy = 0;

	const signalsByTimestamp = new Map<number, Signal>();
	for (const signal of signals) {
		signalsByTimestamp.set(signal.timestamp, signal);
	}

	for (let i = strategy.warmupPeriod; i < candles.length; i++) {
		const candle = candles[i];
		const prevCandle = candles[i - 1];

		portfolio.updateDay(candle.openTime);

		// PHASE 1: Open Orders
		const pendingSignal = signalsByTimestamp.get(prevCandle.openTime);
		if (pendingSignal) {
			if (pendingSignal.side === 'SELL' && portfolio.positions.hasOpen()) {
				const fill = broker.sell(candle.openTime, candle.open, portfolio.positions.getQuantity());
				const trade = portfolio.positions.close(fill, `Signal: ${pendingSignal.reason}`, coin);
				portfolio.addTrade(trade);
				portfolio.addCapital(fill.quantity * fill.price - fill.commission);
				positionsClosed++;
				exitStrategy++;
			} 
			else if (pendingSignal.side === 'BUY' && !portfolio.positions.hasOpen()) {
				const candleIndex = timestampToIndex.get(prevCandle.openTime) ?? -1;
				if (candleIndex >= 0) {
					const fVerdict = filterEngine.evaluate(candleIndex);
					
					let isAccepted = fVerdict.passed;
					if (!fVerdict.passed) {
						const hasAdxVeto = fVerdict.reasons.some(r => r.includes('ADX'));
						const hasRvolVeto = fVerdict.reasons.some(r => r.includes('RVOL'));
						if (hasAdxVeto && hasRvolVeto) bothRejections++;
						else if (hasAdxVeto) adxRejections++;
						else if (hasRvolVeto) rvolRejections++;
					} else {
						filterPassed++;
						const cVerdict = calculateConfidence(fVerdict.adx, fVerdict.rvol, confidenceConfig);
						if (!cVerdict.passed) {
							confidenceRejections++;
							isAccepted = false;
						} else {
							confidencePassed++;
							const rVerdict = evaluateRisk(pendingSignal, portfolio.getCapital(), portfolio.getDailyPnl(), riskConfig);
							if (!rVerdict.approved) {
								riskRejections++;
							} else {
								riskApproved++;
								const fill = broker.buy(candle.openTime, candle.open, rVerdict.positionSize);
								const lastClosedAtr = (i - 1 >= 0) && atrValues.length > (i - 1) && !Number.isNaN(atrValues[i - 1]) ? atrValues[i - 1] : 0;
								const stopLoss = lastClosedAtr > 0 ? fill.price - lastClosedAtr * riskConfig.stopLossAtrMultiplier : 0;

								portfolio.positions.open(fill, fill.quantity, lastClosedAtr, stopLoss);
								const totalCostUsdt = (fill.quantity * fill.price) + fill.commission;
								portfolio.deductCapital(totalCostUsdt);
								positionsOpened++;
							}
						}
					}
				}
			}
		}

		portfolio.positions.updateIntraTradePrices(candle.high, candle.low);

		// PHASE 2: Intra-candle SL/TP
		if (portfolio.positions.hasOpen()) {
			let exitSignal: { exitPrice: number; reason: string } | null = null;
			const pos = portfolio.positions.getPositionInfo();

			if (pos) {
				const entryPrice = pos.entryPrice;
				const slPct = riskConfig.stopLossPercent;
				const tpPct = riskConfig.takeProfitPercent;

				if (slPct && slPct > 0) {
					const slPrice = entryPrice * (1 - slPct);
					if (candle.low <= slPrice) {
						exitSignal = {
							exitPrice: candle.open <= slPrice ? candle.open : slPrice,
							reason: `Stop-Loss Percent (-${(slPct * 100).toFixed(1)}%)`,
						};
						exitSlPercent++;
					}
				}

				if (!exitSignal && tpPct && tpPct > 0) {
					const tpPrice = entryPrice * (1 + tpPct);
					if (candle.high >= tpPrice) {
						exitSignal = {
							exitPrice: candle.open >= tpPrice ? candle.open : tpPrice,
							reason: `Take-Profit Percent (+${(tpPct * 100).toFixed(1)}%)`,
						};
						exitTpPercent++;
					}
				}
			}

			if (!exitSignal) {
				const stopSignal = portfolio.positions.evaluateStopLoss(candle, stopRule);
				if (stopSignal) {
					exitSignal = stopSignal;
					exitAtrStop++;
				}
			}

			if (exitSignal) {
				const fill = broker.sell(candle.openTime, exitSignal.exitPrice, portfolio.positions.getQuantity());
				const trade = portfolio.positions.close(fill, exitSignal.reason, coin);
				portfolio.addTrade(trade);
				portfolio.addCapital(fill.quantity * fill.price - fill.commission);
				positionsClosed++;
			}
		}

		// PHASE 3: Close
		portfolio.recordEquityPoint(candle.openTime, candle.close);
	}

	if (portfolio.positions.hasOpen()) {
		const lastCandle = candles[candles.length - 1];
		const fill = broker.sell(lastCandle.openTime, lastCandle.close, portfolio.positions.getQuantity());
		const trade = portfolio.positions.close(fill, 'End of Backtest Force Exit', coin);
		portfolio.addTrade(trade);
		portfolio.addCapital(fill.quantity * fill.price - fill.commission);
		positionsClosed++;
		exitForce++;
	}

	console.log(`\n====================================================`);
	console.log(`📊 WATERFALL REPORT FOR ${coin} (${interval})`);
	console.log(`====================================================`);
	console.log(`Total Candles     : ${candles.length}`);
	console.log(`Total Signals     : ${totalSignals} (BUY: ${buySignals}, SELL: ${sellSignals})`);
	console.log(`----------------------------------------------------`);
	console.log(`[1] FILTER ENGINE STAGE:`);
	console.log(`    - ADX Rejections        : ${adxRejections}`);
	console.log(`    - RVOL Rejections       : ${rvolRejections}`);
	console.log(`    - BOTH Rejections       : ${bothRejections}`);
	console.log(`    - Total Filter Rejected : ${adxRejections + rvolRejections + bothRejections}`);
	console.log(`    - Passed Filter Stage   : ${filterPassed}`);
	console.log(`----------------------------------------------------`);
	console.log(`[2] CONFIDENCE ENGINE STAGE:`);
	console.log(`    - Confidence Rejected   : ${confidenceRejections}`);
	console.log(`    - Passed Conf. Stage    : ${confidencePassed}`);
	console.log(`----------------------------------------------------`);
	console.log(`[3] RISK MANAGER STAGE:`);
	console.log(`    - Risk Rejected         : ${riskRejections}`);
	console.log(`    - Approved by Risk      : ${riskApproved}`);
	console.log(`----------------------------------------------------`);
	console.log(`[4] EXECUTION ENGINE STAGE:`);
	console.log(`    - Positions Opened      : ${positionsOpened}`);
	console.log(`    - Positions Closed      : ${positionsClosed}`);
	console.log(`      - via Stop-Loss %     : ${exitSlPercent}`);
      console.log(`      - via Take-Profit %   : ${exitTpPercent}`);
	console.log(`      - via ATR Trailing SL : ${exitAtrStop}`);
	console.log(`      - via Strategy EXIT   : ${exitStrategy}`);
	console.log(`      - via Force Close     : ${exitForce}`);
	console.log(`----------------------------------------------------`);
	console.log(`Portfolio Return  : ${round(portfolio.getFinalCapital() / portfolio.getInitialCapital() * 100 - 100, 2)}%`);
	console.log(`====================================================\n`);
}

runWaterfall('BTCUSDT', '1d');
runWaterfall('ETHUSDT', '1d');
