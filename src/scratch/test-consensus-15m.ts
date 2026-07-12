import { createConsensusStrategy } from '../research/strategies/consensus/index.js';
import { runBacktest } from '../research/backtester.js';
import type { Candle } from '../core/types.js';

const tickers = ['THYAO.IS', 'TUPRS.IS', 'EREGL.IS', 'YAPRK.IS', 'PKENT.IS'];

async function fetchStockData15m(ticker: string) {
	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=60d&interval=15m`;
	const res = await fetch(url, {
		headers: {
			'User-Agent': 'Mozilla/5.0'
		}
	});
	if (!res.ok) throw new Error(`Fetch failed for ${ticker}`);
	const data = await res.json();
	const result = data.chart.result[0];
	const ts = result.timestamp;
	const quote = result.indicators.quote[0];
	const opens = quote.open;
	const highs = quote.high;
	const lows = quote.low;
	const closes = quote.close;
	const volumes = quote.volume;

	const candles: Candle[] = [];
	for (let i = 0; i < ts.length; i++) {
		if (opens[i] === null || closes[i] === null) continue;
		candles.push({
			openTime: ts[i] * 1000,
			open: opens[i],
			high: highs[i],
			low: lows[i],
			close: closes[i],
			volume: volumes[i] || 0,
			closeTime: (ts[i] * 1000) + 899999
		});
	}
	return candles;
}

async function run() {
	const platformConfig = {
		commissionPercent: 0.1,
		slippagePercent: 0.05,
		defaultInterval: '15m',
		coins: [],
		initialCapital: 10000,
		makerFee: 0.001,
		takerFee: 0.001,
		slippageModel: 'linear'
	} as any;

	const riskConfig = {
		maxPositionPercent: 20,
		maxDailyLossPercent: 5,
		maxOrderValue: 2000,
		stopLossAtrMultiplier: 2
	} as any;

	const strategyDefaults = {
		strategies: {},
		filters: {
			adxPeriod: 14,
			adxVetoThreshold: 999,
			rvolLookback: 20,
			rvolVetoThreshold: 999
		},
		confidence: {
			baseScore: 40,
			adxStrongThreshold: 25,
			adxStrongBonus: 0,
			rvolHighThreshold: 2.0,
			rvolHighBonus: 0,
			minimumScore: 0
		}
	} as any;

	const strategy = createConsensusStrategy();

	console.log(`\n======================================================`);
	console.log(` CONSENSUS BIST TESTLERI (15 DAKIKALIK - SON 60 GUN)`);
	console.log(`======================================================`);

	const originalLog = console.log;

	for (const ticker of tickers) {
		try {
			const candles = await fetchStockData15m(ticker);
			if (candles.length < 50) {
				originalLog(`  [⚠️] ${ticker.split('.')[0]}: Yetersiz veri (${candles.length} mum). Atlandi.`);
				continue;
			}

			// Mute console
			console.log = () => {};

			const result = runBacktest(strategy, candles, platformConfig, riskConfig, ticker.split('.')[0], strategyDefaults);
			
			// Unmute console
			console.log = originalLog;

			const startPrice = candles[50].close;
			const endPrice = candles[candles.length - 1].close;
			const bhReturn = ((endPrice - startPrice) / startPrice) * 100;

			const totalReturn = result.totalReturnPercent ?? 0;
			const tradesCount = result.tradesCount ?? 0;
			const winRate = result.winRate ?? 0;

			originalLog(`\n HISSE: ${ticker.split('.')[0]}`);
			originalLog(`  Al ve Yat (Buy & Hold) Getirisi: %${bhReturn.toFixed(2)}`);
			originalLog(`  ----------------------------------------------------`);
			originalLog(`  [Consensus] Getiri: %${totalReturn.toFixed(2)} | Islem: ${tradesCount} | Win Rate: %${winRate.toFixed(2)}`);
		} catch (e: any) {
			console.log = originalLog;
			originalLog(`Error for ${ticker}:`, e.message);
		}
	}
	console.log = originalLog;
	console.log(`======================================================\n`);
}

run();
