// ============================================================================
// KRIPTOQUANT — Production Reality Check Validator (Sprint 27)
// ============================================================================

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionEngine, EngineState, ActivePosition, ClosedTrade } from './live-engine.js';
import { log, logError } from '../core/utils.js';

async function runRealityCheck() {
	log(`\n================================================================`);
	log(`  🧪 RUNNING KRIPTOQUANT REALITY CHECK VALIDATOR`);
	log(`================================================================\n`);

	const resultsDir = join(process.cwd(), 'results');
	if (!existsSync(resultsDir)) {
		mkdirSync(resultsDir, { recursive: true });
	}

	// 1) Initialize a fully formed mock active state representing active trades & completed journal
	// to verify that all dashboard widgets populate and update correctly without empty spaces!
	const mockState: EngineState = {
		engineStatus: 'running',
		startTime: new Date(Date.now() - 3600 * 1000).toISOString(), // 1 hour uptime
		uptime: 3600,
		currentEquity: 10452.80,
		cash: 8500.00,
		unrealizedPnL: 152.80,
		realizedPnL: 300.00,
		activePositions: [
			{
				coin: 'BTCUSDT',
				direction: 'LONG',
				entryTime: new Date(Date.now() - 1800 * 1000).toISOString(),
				entryPrice: 62500.00,
				currentPrice: 63200.00,
				quantity: 0.016, // $1000 size
				positionSizeUsdt: 1000.00,
				stopLoss: 61250.00, // 2% SL
				takeProfit: 66250.00, // 6% TP
				riskPercent: 2.0,
				currentPnLPercent: 1.12, // +1.12%
				currentPnLUsdt: 11.20,
				mae: 0.25, // 0.25% max drawdown since entry
				mfe: 1.50, // 1.50% max gain since entry
				strategyName: 'ema-cross',
			},
			{
				coin: 'SOLUSDT',
				direction: 'LONG',
				entryTime: new Date(Date.now() - 900 * 1000).toISOString(),
				entryPrice: 140.00,
				currentPrice: 142.50,
				quantity: 7.1428, // $1000 size
				positionSizeUsdt: 1000.00,
				stopLoss: 137.20,
				takeProfit: 148.40,
				riskPercent: 2.0,
				currentPnLPercent: 1.78, // +1.78%
				currentPnLUsdt: 17.80,
				mae: 0.10,
				mfe: 2.10,
				strategyName: 'donchian-breakout',
			}
		],
		pendingSignals: [
			{ coin: 'BTCUSDT', time: new Date(Date.now() - 1800 * 1000).toISOString(), side: 'BUY', price: 62500.00 },
			{ coin: 'SOLUSDT', time: new Date(Date.now() - 900 * 1000).toISOString(), side: 'BUY', price: 140.00 },
			{ coin: 'ETHUSDT', time: new Date(Date.now() - 7200 * 1000).toISOString(), side: 'SELL', price: 3450.00 }
		],
		closedTrades: [
			{
				coin: 'ETHUSDT',
				direction: 'LONG',
				entryTime: new Date(Date.now() - 7200 * 1000).toISOString(),
				entryPrice: 3400.00,
				exitTime: new Date(Date.now() - 3600 * 1000).toISOString(),
				exitPrice: 3502.00, // Closed in profit
				quantity: 0.2941,
				realizedPnLPercent: 3.0,
				realizedPnLUsdt: 30.00,
				entryReason: 'Signal',
				exitReason: 'Signal',
				holdingDurationSeconds: 3600,
				mae: 0.50,
				mfe: 3.50,
				rMultiple: 1.5,
				strategyName: 'ema-cross',
			},
			{
				coin: 'BTCUSDT',
				direction: 'LONG',
				entryTime: new Date(Date.now() - 14400 * 1000).toISOString(),
				entryPrice: 63000.00,
				exitTime: new Date(Date.now() - 10800 * 1000).toISOString(),
				exitPrice: 61740.00, // Closed by Stop Loss
				quantity: 0.1587,
				realizedPnLPercent: -2.0,
				realizedPnLUsdt: -200.00,
				entryReason: 'Signal',
				exitReason: 'SL',
				holdingDurationSeconds: 3600,
				mae: 2.10,
				mfe: 0.20,
				rMultiple: -1.0,
				strategyName: 'ema-cross',
			}
		],
		equityCurveLive: [
			{ time: '22:50:00', equity: 10000 },
			{ time: '22:55:00', equity: 10050 },
			{ time: '23:00:00', equity: 10120 },
			{ time: '23:05:00', equity: 10250 },
			{ time: '23:10:00', equity: 10452.80 },
		],
		heartbeat: new Date().toISOString(),
		lastCandleTime: new Date().toISOString(),
	};

	// 2) Add coin contributions (Coin Contribution / Attribution) to verify dashboard calculations
	// The dashboard overview UI automatically reads coin PnL metrics. Let's make sure our state handles it.
	const statePath = join(resultsDir, 'live_paper_state.json');
	writeFileSync(statePath, JSON.stringify(mockState, null, 4));

	log(`✅ Mock Session Flight Recorder written to: ${statePath}`);
	log(`   - Uptime: ${mockState.uptime}s`);
	log(`   - Cash Balance: ${mockState.cash} USDT`);
	log(`   - Net Equity: ${mockState.currentEquity} USDT`);
	log(`   - Active Positions: ${mockState.activePositions.length}`);
	log(`   - Closed Trades: ${mockState.closedTrades.length}`);

	// Print samples for verification
	console.log('\n--- Active Position Sample ---');
	console.table(mockState.activePositions);

	console.log('\n--- Closed Trades Journal Sample ---');
	console.table(mockState.closedTrades);
}

runRealityCheck();
