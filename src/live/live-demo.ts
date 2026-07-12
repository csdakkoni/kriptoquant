// ============================================================================
// KRIPTOQUANT — Real-Time Live Execution Demo (Sprint 27)
// ============================================================================

import { startExecutionEngine, stopExecutionEngine, EngineState } from './live-engine.js';
import { log, logError } from '../core/utils.js';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function runLiveDemo() {
	log(`\n================================================================`);
	log(`  🚀 STARTING LIVE REAL-TIME DEMO (BINANCE WEBSOCKETS & ENGINE)`);
	log(`  Strateji: fast-ema-cross (EMA 2/3 - Crossover)`);
	log(`  Varlıklar: BTCUSDT, ETHUSDT`);
	log(`  Aralık   : 1m`);
	log(`================================================================\n`);

	// Reset state file on start to start fresh
	const statePath = join(process.cwd(), 'results', 'live_paper_state.json');
	const initialState: EngineState = {
		engineStatus: 'running',
		startTime: new Date().toISOString(),
		uptime: 0,
		currentEquity: 10000,
		cash: 10000,
		unrealizedPnL: 0,
		realizedPnL: 0,
		activePositions: [],
		pendingSignals: [],
		closedTrades: [],
		equityCurveLive: [],
		heartbeat: new Date().toISOString(),
		lastCandleTime: '',
	};
	writeFileSync(statePath, JSON.stringify(initialState, null, 4));
	log(`✓ Initialized fresh live_paper_state.json with 10,000 USDT cash.`);

	// Start ExecutionEngine
	const engine = await startExecutionEngine(
		['BTCUSDT', 'ETHUSDT'],
		'1m',
		'ema-cross',
		(state: any) => {
			// Callback when engine state updates (saves to disk and broadcasts)
			// Let's log updates to console
		}
	);

	// Let's listen and print custom pretty logs of engine activities to console
	let secondsElapsed = 0;
	const interval = setInterval(() => {
		secondsElapsed += 2;
		const state = engine.getState();

		console.log(`\n⏰ [${new Date().toLocaleTimeString()}] Uptime: ${state.uptime}s | Uçuş Verileri:`);
		console.log(`   - Portföy Değeri (Equity): ${state.currentEquity.toFixed(2)} USDT`);
		console.log(`   - Boş Nakit (Cash)        : ${state.cash.toFixed(2)} USDT`);
		console.log(`   - unrealizedPnL           : ${state.unrealizedPnL.toFixed(2)} USDT`);
		console.log(`   - realizedPnL             : ${state.realizedPnL.toFixed(2)} USDT`);

		if (state.activePositions.length > 0) {
			console.log(`   - Açık Pozisyonlar (${state.activePositions.length}):`);
			state.activePositions.forEach(p => {
				console.log(`     👉 [${p.coin}] Giriş: $${p.entryPrice.toFixed(2)} | Güncel: $${p.currentPrice.toFixed(2)} | SL: $${p.stopLoss.toFixed(2)} | TP: $${p.takeProfit.toFixed(2)} | PnL: ${p.currentPnLPercent.toFixed(2)}% | MAE: ${p.mae.toFixed(2)}% | MFE: ${p.mfe.toFixed(2)}%`);
			});
		} else {
			console.log(`   - Açık Pozisyon: YOK`);
		}

		if (state.closedTrades.length > 0) {
			console.log(`   - Tamamlanan İşlemler (${state.closedTrades.length}):`);
			state.closedTrades.slice(-2).forEach(t => {
				console.log(`     ✅ [${t.coin}] ${t.realizedPnLPercent >= 0 ? 'KÂR' : 'ZARAR'}: ${t.realizedPnLPercent.toFixed(2)}% ($${t.realizedPnLUsdt.toFixed(2)}) | Durasyon: ${t.holdingDurationSeconds}s | R-Mult: ${t.rMultiple.toFixed(2)}R | Çıkış: ${t.exitReason}`);
			});
		}

		// Quit after 3 minutes (180 seconds) to wrap up the demonstration printout
		if (secondsElapsed >= 180) {
			log(`\n================================================================`);
			log(`  🛑 DEMO COMPLETED SUCCESSFULLY AFTER 3 MINUTES`);
			log(`  ExecutionEngine is stopping.`);
			log(`================================================================\n`);
			clearInterval(interval);
			engine.stop();
			process.exit(0);
		}
	}, 2000);
}

runLiveDemo().catch(e => {
	logError(`Live demo failed: ${e}`);
	process.exit(1);
});
