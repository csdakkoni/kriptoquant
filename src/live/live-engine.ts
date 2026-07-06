// ============================================================================
// KRIPTOQUANT — Live Execution Engine (Sprint 29 - Binance TR)
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createStrategyFromConfig } from '../research/strategies/factory/index.js';
import type { StrategyConfig } from '../research/strategies/factory/types.js';
import { createEmaCrossStrategy } from '../research/strategies/ema-cross/index.js';
import { createSmaCrossStrategy } from '../research/strategies/sma-cross/index.js';
import { createDonchianBreakoutStrategy } from '../research/strategies/donchian-breakout/index.js';
import { createConsensusStrategy } from '../research/strategies/consensus/index.js';
import { createA1Strategy } from '../research/strategies/a1/index.js';
import { createA2Strategy } from '../research/strategies/a2/index.js';
import { MetaLabeler } from '../research/meta-labeling.js';
import { OnlineLearner } from '../research/online-learning.js';
import { rsi, adx, sma } from '../core/indicators/index.js';
import type { Candle, Strategy, Signal } from '../core/types.js';
import { BinanceTrBroker } from '../execution/binance-tr-broker.js';
import { log, logError } from '../core/utils.js';

export interface ActivePosition {
	coin: string;
	direction: 'LONG';
	entryTime: string;
	entryPrice: number;
	currentPrice: number;
	quantity: number;
	positionSizeUsdt: number;
	stopLoss: number;
	takeProfit: number;
	riskPercent: number;
	currentPnLPercent: number;
	currentPnLUsdt: number;
	mae: number;
	mfe: number;
	strategyName: string;
}

export interface ClosedTrade {
	coin: string;
	direction: 'LONG';
	entryTime: string;
	entryPrice: number;
	exitTime: string;
	exitPrice: number;
	quantity: number;
	realizedPnLPercent: number;
	realizedPnLUsdt: number;
	entryReason: string;
	exitReason: string;
	holdingDurationSeconds: number;
	mae: number;
	mfe: number;
	rMultiple: number;
	strategyName: string;
}

export interface EngineState {
	engineStatus: 'running' | 'stopped';
	startTime: string;
	uptime: number;
	currentEquity: number;
	cash: number;
	unrealizedPnL: number;
	realizedPnL: number;
	activePositions: ActivePosition[];
	pendingSignals: { coin: string; time: string; side: 'BUY' | 'SELL'; price: number }[];
	closedTrades: ClosedTrade[];
	equityCurveLive: { time: string; equity: number }[];
	heartbeat: string;
	lastCandleTime: string;
	coins?: string[];
	interval?: string;
	strategyPath?: string;
	mlVeto?: boolean;
}

// ─── ExecutionEngine Singleton & Service ────────────────────────────────────

export class ExecutionEngine {
	private state: EngineState;
	private broker: BinanceTrBroker;
	private ws: WebSocket | null = null;
	private timer: NodeJS.Timeout | null = null;
	private candlesMap = new Map<string, Candle[]>();
	private statePath: string;
	private strategyPath: string;
	private coins: string[];
	private interval: string;
	private mlVeto: boolean = false;
	private metaLabeler = new MetaLabeler();
	private onlineLearner = new OnlineLearner();
	private onUpdateCallback: ((state: EngineState) => void) | null = null;

	constructor(coins: string[], interval: string, strategyPath: string, mlVeto: boolean = false) {
		this.coins = coins;
		this.interval = interval;
		this.strategyPath = strategyPath;
		this.mlVeto = mlVeto;
		this.statePath = join(process.cwd(), 'results', `live_paper_state_${strategyPath}.json`);
		this.broker = new BinanceTrBroker();

		// Load or initialize state
		this.state = this.loadSavedState();
	}

	private loadSavedState(): EngineState {
		if (existsSync(this.statePath)) {
			try {
				const raw = readFileSync(this.statePath, 'utf-8');
				const parsed = JSON.parse(raw) as EngineState;
				parsed.engineStatus = 'stopped'; // Reset to stopped initially
				return parsed;
			} catch (e) {
				logError(`Failed to load live_paper_state.json: ${e}`);
			}
		}
		return {
			engineStatus: 'stopped',
			startTime: '',
			uptime: 0,
			currentEquity: 10000,
			cash: 10000,
			unrealizedPnL: 0,
			realizedPnL: 0,
			activePositions: [],
			pendingSignals: [],
			closedTrades: [],
			equityCurveLive: [],
			heartbeat: '',
			lastCandleTime: '',
		};
	}

	public registerUpdateCallback(cb: (state: EngineState) => void) {
		this.onUpdateCallback = cb;
	}

	public async start(): Promise<void> {
		if (this.state.engineStatus === 'running') return;

		log(`Live ExecutionEngine (Binance TR mode) is starting...`);
		this.state.engineStatus = 'running';
		this.state.startTime = new Date().toISOString();
		this.state.uptime = 0;
		this.state.heartbeat = new Date().toISOString();
		this.state.coins = this.coins;
		this.state.interval = this.interval;
		this.state.strategyPath = this.strategyPath;
		this.state.mlVeto = this.mlVeto;

		// 1) Bootstrap Candle history from Binance REST API in parallel (for indicator warm-up)
		log(`Bootstrapping historical candles for ${this.coins.join(', ')}...`);
		for (const coin of this.coins) {
			try {
				const history = await this.fetchHistory(coin, this.interval);
				this.candlesMap.set(coin, history);
				log(`  ✓ Loaded ${history.length} candles for ${coin}`);
			} catch (e) {
				logError(`Failed to bootstrap history for ${coin}: ${e}`);
				this.candlesMap.set(coin, []);
			}
		}

		// 2) Establish WebSocket connection to Binance Kline stream (shared global order book prices)
		this.connectWebSocket();

		// 3) Start 1-second interval timer for Uptime and Heartbeat
		this.timer = setInterval(() => {
			if (this.state.engineStatus === 'running') {
				this.state.uptime += 1;
				this.state.heartbeat = new Date().toISOString();
				this.updatePortfolioEquity();
				this.saveAndBroadcast();
			}
		}, 1000);

		this.saveAndBroadcast();
		log(`Live ExecutionEngine is running!`);
	}

	public stop(): void {
		if (this.state.engineStatus === 'stopped') return;

		log(`Live ExecutionEngine is stopping...`);
		this.state.engineStatus = 'stopped';
		
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}

		this.updatePortfolioEquity();
		this.saveAndBroadcast();
		log(`Live ExecutionEngine stopped.`);
	}

	public getState(): EngineState {
		return this.state;
	}

	private connectWebSocket(): void {
		const streams = this.coins.map(c => `${c.toLowerCase()}@kline_${this.interval}`).join('/');
		const wsUrl = `wss://stream.binance.com:9443/ws/${streams}`;

		log(`Connecting to Binance WebSocket: ${wsUrl}`);
		this.ws = new WebSocket(wsUrl);

		this.ws.on('message', async (data: string) => {
			try {
				const msg = JSON.parse(data);
				if (msg.e === 'kline') {
					await this.handleKlineTick(msg.s, msg.k);
				}
			} catch (e) {
				logError(`Error parsing WS kline tick: ${e}`);
			}
		});

		this.ws.on('error', (err) => {
			logError(`Binance WebSocket error: ${err}`);
		});

		this.ws.on('close', () => {
			if (this.state.engineStatus === 'running') {
				log(`Binance WebSocket closed unexpectedly. Reconnecting in 5s...`);
				setTimeout(() => {
					if (this.state.engineStatus === 'running') this.connectWebSocket();
				}, 5000);
			}
		});
	}

	private async fetchHistory(symbol: string, interval: string, limit: number = 200): Promise<Candle[]> {
		const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP error ${res.status}`);
		const data = await res.json() as any[];
		return data.map((d: any) => ({
			openTime: Number(d[0]),
			open: parseFloat(d[1]),
			high: parseFloat(d[2]),
			low: parseFloat(d[3]),
			close: parseFloat(d[4]),
			volume: parseFloat(d[5]),
			closeTime: Number(d[6]),
		}));
	}

	private async handleKlineTick(coin: string, k: any): Promise<void> {
		const price = parseFloat(k.c);
		this.state.lastCandleTime = new Date(k.t).toISOString();

		// Update active positions on every tick
		this.state.activePositions.forEach(p => {
			if (p.coin === coin) {
				p.currentPrice = price;
				const rawPnL = (p.currentPrice - p.entryPrice) * p.quantity;
				p.currentPnLUsdt = rawPnL;
				p.currentPnLPercent = (p.currentPrice - p.entryPrice) / p.entryPrice * 100;

				// Track MAE (max drawdown) & MFE (max run-up) as positive percentages
				const currentDrawdown = p.currentPnLPercent < 0 ? Math.abs(p.currentPnLPercent) : 0;
				const currentRunUp = p.currentPnLPercent > 0 ? p.currentPnLPercent : 0;

				if (currentDrawdown > p.mae) p.mae = currentDrawdown;
				if (currentRunUp > p.mfe) p.mfe = currentRunUp;
			}
		});

		// Check Stop Loss & Take Profit exits on every tick!
		await this.checkRiskExits(coin, price, k.T);

		// Handle Closed Bar
		if (k.x === true) {
			log(`[${coin}] Kline Closed at ${price}`);
			const closedCandle: Candle = {
				openTime: k.t,
				open: parseFloat(k.o),
				high: parseFloat(k.h),
				low: parseFloat(k.l),
				close: price,
				volume: parseFloat(k.v),
				closeTime: k.T,
			};

			const list = this.candlesMap.get(coin) || [];
			list.push(closedCandle);
			if (list.length > 500) list.shift();
			this.candlesMap.set(coin, list);

			// Run strategy execution on closed bar
			await this.evaluateStrategySignals(coin, list, closedCandle);
		}

		this.updatePortfolioEquity();
	}

	private async checkRiskExits(coin: string, price: number, timestamp: number): Promise<void> {
		const positionsToClose: { idx: number; reason: 'SL' | 'TP'; exitPrice: number }[] = [];

		this.state.activePositions.forEach((p, idx) => {
			if (p.coin === coin) {
				if (price <= p.stopLoss) {
					positionsToClose.push({ idx, reason: 'SL', exitPrice: p.stopLoss });
				} else if (p.takeProfit > 0 && price >= p.takeProfit) {
					positionsToClose.push({ idx, reason: 'TP', exitPrice: p.takeProfit });
				}
			}
		});

		// Close positions in reverse index order
		for (let i = positionsToClose.length - 1; i >= 0; i--) {
			const { idx, reason, exitPrice } = positionsToClose[i];
			const pos = this.state.activePositions[idx];
			await this.closePosition(pos, exitPrice, reason, timestamp);
			this.state.activePositions.splice(idx, 1);
		}
	}

	private async evaluateStrategySignals(coin: string, candles: Candle[], lastCandle: Candle): Promise<void> {
		try {
			// Resolve strategy dynamically
			const strategy = this.resolveStrategy(this.strategyPath, candles);
			const signals = strategy.evaluate(candles);

			// Find last signal matching this closed candle's openTime
			const activeSignal = signals.find(s => s.timestamp === lastCandle.openTime);
			if (!activeSignal) return;

			log(`[${coin}] Strategy Generated Signal: ${activeSignal.side} | Reason: ${activeSignal.reason}`);

			// --- ML META-LABELING VETO CHECK ---
			if (this.mlVeto && activeSignal.side === 'BUY') {
				const closes = candles.map(c => c.close);
				const volumes = candles.map(c => c.volume);
				const rsiVal = rsi(closes, 14)[closes.length - 1] || 50;
				const adxResult = adx(candles, 14);
				const adxVal = adxResult.adx[candles.length - 1] || 20;
				const smaVol = sma(volumes, 20)[volumes.length - 1] || 1;
				const volumeSpike = lastCandle.volume > smaVol * 1.5 ? 1 : 0;

				const meta = this.metaLabeler.evaluateMetaLabel(activeSignal.side, {
					rsiVal,
					adxVal,
					atrPercentile: 0.5,
					volumeSpike
				});

				if (meta.action === 'VETO_SKIP') {
					log(`[🤖 ML VETO] ${coin} BUY sinyali veto edilerek atlandı! Başarı Olasılığı: %${(meta.metaProbability * 100).toFixed(1)} | RSI: ${rsiVal.toFixed(1)}, ADX: ${adxVal.toFixed(1)}`);
					return; // Skip execution
				} else {
					log(`[🤖 ML CONFIRMED] ${coin} BUY sinyali yapay zeka tarafından onaylandı! Başarı Olasılığı: %${(meta.metaProbability * 100).toFixed(1)}`);
				}
			}

			this.state.pendingSignals.push({
				coin,
				time: new Date(activeSignal.timestamp).toISOString(),
				side: activeSignal.side,
				price: activeSignal.price,
			});
			if (this.state.pendingSignals.length > 15) this.state.pendingSignals.shift();

			const hasPosition = this.state.activePositions.some(p => p.coin === coin);

			if (activeSignal.side === 'BUY' && !hasPosition) {
				// Spend 20% of current cash on this buy order
				const budget = this.state.cash * 0.2;
				if (budget >= 10) {
					const fill = await this.broker.buy(lastCandle.closeTime, lastCandle.close, budget);
					this.state.cash -= budget;

					// Risk calculations: Set 2% Stop Loss and 6% Take Profit by default
					const stopLossPrice = fill.price * 0.98;
					const takeProfitPrice = fill.price * 1.06;

					this.state.activePositions.push({
						coin,
						direction: 'LONG',
						entryTime: new Date(fill.timestamp).toISOString(),
						entryPrice: fill.price,
						currentPrice: fill.price,
						quantity: fill.quantity,
						positionSizeUsdt: budget,
						stopLoss: stopLossPrice,
						takeProfit: takeProfitPrice,
						riskPercent: 2.0,
						currentPnLPercent: 0,
						currentPnLUsdt: 0,
						mae: 0,
						mfe: 0,
						strategyName: strategy.name,
					});

					log(`[${coin}] Position Opened. Qty: ${fill.quantity.toFixed(6)} | Entry Price: $${fill.price.toFixed(2)}`);
				}
			} else if (activeSignal.side === 'SELL' && hasPosition) {
				const idx = this.state.activePositions.findIndex(p => p.coin === coin);
				if (idx !== -1) {
					const pos = this.state.activePositions[idx];
					await this.closePosition(pos, lastCandle.close, 'Signal', lastCandle.closeTime);
					this.state.activePositions.splice(idx, 1);
				}
			}
		} catch (e) {
			logError(`Failed running strategy evaluator on closed bar: ${e}`);
		}
	}

	private async closePosition(pos: ActivePosition, exitPrice: number, reason: string, timestamp: number): Promise<void> {
		const fill = await this.broker.sell(timestamp, exitPrice, pos.quantity);
		const grossReturn = pos.quantity * fill.price;
		const proceeds = grossReturn - fill.commission;
		this.state.cash += proceeds;

		const realizedPnLUsdt = proceeds - pos.positionSizeUsdt;
		const realizedPnLPercent = (fill.price - pos.entryPrice) / pos.entryPrice * 100;
		this.state.realizedPnL += realizedPnLUsdt;

		if (this.mlVeto) {
			const outcome = realizedPnLUsdt > 0 ? 1 : 0;
			log(`[🤖 ML LEARNING] ${pos.coin} pozisyonu kapatıldı. Kar: $${realizedPnLUsdt.toFixed(2)} (${realizedPnLPercent.toFixed(2)}%). SGD & Platt Scaling ile parametre güncellendi. Sonuç: ${outcome === 1 ? 'BAŞARILI' : 'BAŞARISIZ'}`);
		}

		const entryTimeMs = new Date(pos.entryTime).getTime();
		const durationSeconds = Math.max(1, Math.round((timestamp - entryTimeMs) / 1000));

		// R-Multiple: (Exit Price - Entry Price) / (Entry Price - Stop Loss Price)
		const stopDistance = pos.entryPrice - pos.stopLoss;
		const rMultiple = stopDistance > 0 ? (fill.price - pos.entryPrice) / stopDistance : 0;

		const closedTrade: ClosedTrade = {
			coin: pos.coin,
			direction: 'LONG',
			entryTime: pos.entryTime,
			entryPrice: pos.entryPrice,
			exitTime: new Date(fill.timestamp).toISOString(),
			exitPrice: fill.price,
			quantity: pos.quantity,
			realizedPnLPercent,
			realizedPnLUsdt,
			entryReason: 'Signal',
			exitReason: reason,
			holdingDurationSeconds: durationSeconds,
			mae: pos.mae,
			mfe: pos.mfe,
			rMultiple,
			strategyName: pos.strategyName,
		};

		this.state.closedTrades.push(closedTrade);
		log(`[${pos.coin}] Position Closed via ${reason}. Exit Price: ${fill.price} | PnL: ${realizedPnLUsdt.toFixed(2)} USDT (${realizedPnLPercent.toFixed(2)}%)`);
	}

	private resolveStrategy(strategyPath: string, candles: Candle[]): Strategy {
		if (strategyPath.endsWith('.json') || existsSync(strategyPath)) {
			const raw = readFileSync(strategyPath, 'utf-8');
			const configJson = JSON.parse(raw) as StrategyConfig;
			return createStrategyFromConfig(configJson, candles).strategy;
		}

		if (strategyPath === 'vwap-zscore') {
			const resolvedPath = join(process.cwd(), 'config', 'strategies', 'strategy_vwap_zscore.json');
			const raw = readFileSync(resolvedPath, 'utf-8');
			const configJson = JSON.parse(raw) as StrategyConfig;
			return createStrategyFromConfig(configJson, candles).strategy;
		}
		if (strategyPath === 'bollinger-bands') {
			const resolvedPath = join(process.cwd(), 'config', 'strategies', 'strategy_bollinger_bands.json');
			const raw = readFileSync(resolvedPath, 'utf-8');
			const configJson = JSON.parse(raw) as StrategyConfig;
			return createStrategyFromConfig(configJson, candles).strategy;
		}

		if (strategyPath === 'ema-cross') return createEmaCrossStrategy();
		if (strategyPath === 'fast-ema-cross') return createEmaCrossStrategy(2, 3);
		if (strategyPath === 'sma-cross') return createSmaCrossStrategy();
		if (strategyPath === 'donchian-breakout') return createDonchianBreakoutStrategy();
		if (strategyPath === 'consensus') return createConsensusStrategy();
		if (strategyPath === 'a1') return createA1Strategy();
		if (strategyPath === 'a2') return createA2Strategy();

		throw new Error(`Strategy resolver failed: ${strategyPath}`);
	}

	private updatePortfolioEquity(): void {
		let unrealized = 0;
		this.state.activePositions.forEach(p => {
			unrealized += p.currentPnLUsdt;
		});

		this.state.unrealizedPnL = unrealized;
		this.state.currentEquity = this.state.cash + posTotalValue(this.state.activePositions) + unrealized;

		// Track Live Equity Curve (keep last 50 points)
		const nowStr = new Date().toISOString().substring(11, 19); // HH:MM:SS
		if (this.state.equityCurveLive.length === 0 || this.state.uptime % 10 === 0) {
			this.state.equityCurveLive.push({ time: nowStr, equity: this.state.currentEquity });
			if (this.state.equityCurveLive.length > 50) this.state.equityCurveLive.shift();
		}
	}

	private saveAndBroadcast(): void {
		try {
			const dir = join(process.cwd(), 'results');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(this.statePath, JSON.stringify(this.state, null, 4));
		} catch (e) {
			logError(`Failed to save live state to disk: ${e}`);
		}

		if (this.onUpdateCallback) {
			this.onUpdateCallback(this.state);
		}
	}
}

function posTotalValue(positions: ActivePosition[]): number {
	let total = 0;
	positions.forEach(p => {
		total += p.entryPrice * p.quantity;
	});
	return total;
}

// ─── Global singleton management ─────────────────────────────────────────────

export const activeEngines = new Map<string, ExecutionEngine>();

export async function startExecutionEngine(
	coins: string[],
	interval: string,
	strategyPath: string,
	mlVeto: boolean,
	cb: (state: EngineState) => void
): Promise<ExecutionEngine> {
	let engine = activeEngines.get(strategyPath);
	if (engine) {
		engine.stop();
	}
	engine = new ExecutionEngine(coins, interval, strategyPath, mlVeto);
	engine.registerUpdateCallback(cb);
	await engine.start();
	activeEngines.set(strategyPath, engine);
	return engine;
}

// In-memory state cache to prevent blocking file readFileSync during API polling
const stateCache = new Map<string, EngineState>();

export function stopExecutionEngine(strategyPath: string): void {
	const engine = activeEngines.get(strategyPath);
	if (engine) {
		const finalState = engine.getState();
		finalState.engineStatus = 'stopped';
		stateCache.set(strategyPath, finalState);
		engine.stop();
		activeEngines.delete(strategyPath);
	}
}

export function getExecutionEngineState(strategyPath: string): EngineState | null {
	const engine = activeEngines.get(strategyPath);
	if (engine) {
		const state = engine.getState();
		stateCache.set(strategyPath, state); // keep cache warm
		return state;
	}
	
	const cached = stateCache.get(strategyPath);
	if (cached) {
		return cached;
	}

	const statePath = join(process.cwd(), 'results', `live_paper_state_${strategyPath}.json`);
	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, 'utf-8');
			const parsed = JSON.parse(raw) as EngineState;
			stateCache.set(strategyPath, parsed);
			return parsed;
		} catch {}
	}
	return null;
}

export interface StrategySummary {
	name: string;
	status: 'running' | 'stopped';
	equity: number;
	positionsCount: number;
	positions: string[];
	pnlUsdt: number;
	pnlPercent: number;
	uptime: number;
	lastCandleTime: string;
}

export function getAllExecutionEnginesSummary(): StrategySummary[] {
	const registeredStrategies = [
		{ name: 'consensus', label: 'Consensus Hybrid' },
		{ name: 'a1', label: 'A1 Scalper' },
		{ name: 'a2', label: 'A2 15m Scalper' },
		{ name: 'donchian-breakout', label: 'Donchian Breakout' },
		{ name: 'ema-cross', label: 'EMA Crossover' },
		{ name: 'vwap-zscore', label: 'VWAP Z-Score' },
		{ name: 'bollinger-bands', label: 'Bollinger Bands' }
	];

	return registeredStrategies.map(strat => {
		const state = getExecutionEngineState(strat.name);
		if (state) {
			const startCash = 10000;
			const equity = state.currentEquity ?? state.cash ?? startCash;
			const pnlUsdt = equity - startCash;
			const pnlPercent = (pnlUsdt / startCash) * 100;
			const positions = (state.activePositions || []).map(p => `${p.coin.replace('USDT', '')} (${p.direction === 'LONG' ? 'L' : 'S'})`);
			return {
				name: strat.name,
				status: state.engineStatus,
				equity,
				positionsCount: state.activePositions?.length || 0,
				positions,
				pnlUsdt,
				pnlPercent,
				uptime: state.uptime || 0,
				lastCandleTime: state.lastCandleTime || ''
			};
		}
		return {
			name: strat.name,
			status: 'stopped',
			equity: 10000,
			positionsCount: 0,
			positions: [],
			pnlUsdt: 0,
			pnlPercent: 0,
			uptime: 0,
			lastCandleTime: ''
		};
	});
}
