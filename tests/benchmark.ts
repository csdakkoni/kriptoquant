// ============================================================================
// KRIPTOQUANT — Performance Profiler & Benchmark Suite (Sprint 20)
// ============================================================================

import type { Candle, Strategy } from '../src/core/types.js';
import { runBacktest } from '../src/research/backtester.js';
import { runMonteCarlo } from '../src/research/analytics/monte-carlo.js';
import { runPortfolioExecution } from '../src/execution/portfolio/portfolio-engine.js';
import { CSVTimelineProvider } from '../src/execution/portfolio/timeline-provider.js';
import { EqualWeightAllocation } from '../src/execution/portfolio/allocation.js';
import { ema } from '../src/core/indicators/index.js';

// Mock Configs
const platformConfig = {
	initialCapital: 10000,
	defaultInterval: '1d',
	slippagePercent: 0.1,
	makerFeePercent: 0.02,
	takerFeePercent: 0.04,
};

const riskParams = {
	stopLossPercent: 2.0,
	takeProfitPercent: 6.0,
	trailingStopPercent: 0.0,
	useAtrStop: false,
};

function generateMockCandles(count: number): Candle[] {
	const candles: Candle[] = [];
	let price = 100;
	const now = Date.now() - count * 60000;
	for (let i = 0; i < count; i++) {
		const t = now + i * 60000;
		// small sine wave to trigger trades
		price += Math.sin(i / 10) * 0.5 + 0.1;
		candles.push({
			openTime: t,
			closeTime: t + 60000,
			open: price - 0.05,
			high: price + 0.5,
			low: price - 0.5,
			close: price,
			volume: 1000,
		});
	}
	return candles;
}

function createDummyStrategy(candles: Candle[]): Strategy {
	const closes = candles.map((c) => c.close);
	const fastEma = ema(closes, 9);
	const slowEma = ema(closes, 21);

	return {
		name: 'benchmark-strategy',
		description: 'Ema cross for benchmark',
		warmupPeriod: 25,
		evaluate(inputCandles: Candle[]) {
			const signals: any[] = [];
			for (let i = 25; i < inputCandles.length; i++) {
				if (fastEma[i] > slowEma[i] && fastEma[i - 1] <= slowEma[i - 1]) {
					signals.push({
						timestamp: inputCandles[i].openTime,
						side: 'BUY',
						price: inputCandles[i].close,
						confidence: 1.0,
					});
				} else if (fastEma[i] < slowEma[i] && fastEma[i - 1] >= slowEma[i - 1]) {
					signals.push({
						timestamp: inputCandles[i].openTime,
						side: 'SELL',
						price: inputCandles[i].close,
						confidence: 1.0,
					});
				}
			}
			return signals;
		},
	};
}

async function runBenchmarkForSize(size: number) {
	console.log(`\n📊 Yük Testi Başlıyor: ${size.toLocaleString()} mum...`);

	const startMem = process.memoryUsage().heapUsed;
	const t0 = performance.now();
	const candles = generateMockCandles(size);
	const t1 = performance.now();
	console.log(`  ✔ Veri üretimi: ${(t1 - t0).toFixed(2)} ms`);

	// Strategy Build
	const t2 = performance.now();
	const strategy = createDummyStrategy(candles);
	const t3 = performance.now();
	console.log(`  ✔ İndikatör hesaplama: ${(t3 - t2).toFixed(2)} ms`);

	// Backtest Run
	const t4 = performance.now();
	const result = runBacktest(strategy, candles, platformConfig, riskParams, 'BENCH');
	const t5 = performance.now();
	console.log(`  ✔ Backtest süresi: ${(t5 - t4).toFixed(2)} ms (İşlem adedi: ${result.totalTrades})`);

	// Monte Carlo (1000 simulations)
	const tradesPnl = result.trades.map((t) => t.pnlPercent);
	const t6 = performance.now();
	if (tradesPnl.length > 0) {
		runMonteCarlo(tradesPnl, platformConfig.initialCapital, {
			simulationsCount: 1000,
			method: 'bootstrap',
		});
	}
	const t7 = performance.now();
	console.log(`  ✔ Monte Carlo (1000 sim): ${(t7 - t6).toFixed(2)} ms`);

	// Portfolio execution on Ema Cross strategy (using two assets of this size)
	const timelineProvider = new CSVTimelineProvider();
	const candlesMap = new Map<string, Candle[]>();
	candlesMap.set('BENCH1', candles);
	candlesMap.set('BENCH2', candles);

	const t8 = performance.now();
	const alignedTimeline = timelineProvider.alignCandles(candlesMap);
	const strategiesMap = new Map<string, Strategy>();
	strategiesMap.set('BENCH1', strategy);
	strategiesMap.set('BENCH2', strategy);

	runPortfolioExecution(
		alignedTimeline,
		candlesMap,
		strategiesMap,
		new EqualWeightAllocation(),
		platformConfig,
		riskParams,
		{ maxPositions: 2 }
	);
	const t9 = performance.now();
	console.log(`  ✔ Portföy Yürütme (2 varlık): ${(t9 - t8).toFixed(2)} ms`);

	const endMem = process.memoryUsage().heapUsed;
	const diffMem = (endMem - startMem) / 1024 / 1024;
	console.log(`  ✔ Harcanan Bellek (Heap): ${diffMem.toFixed(2)} MB`);
}

async function main() {
	console.log('═'.repeat(64));
	console.log('  ⚡ KRIPTOQUANT PERFORMANCE BENCHMARK');
	console.log('═'.repeat(64));

	await runBenchmarkForSize(10000);
	await runBenchmarkForSize(100000);
	await runBenchmarkForSize(500000);

	console.log('\n═'.repeat(64));
	console.log('  🎉 BENCHMARK RUN COMPLETED SUCCESSFULLY!');
	console.log('═'.repeat(64));
}

main().catch(console.error);
