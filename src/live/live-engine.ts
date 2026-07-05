// ============================================================================
// KRIPTOQUANT — Live Execution Engine (Sprint 26)
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createStrategyFromConfig } from '../research/strategies/factory/index.js';
import type { StrategyConfig } from '../research/strategies/factory/types.js';
import { createEmaCrossStrategy } from '../research/strategies/ema-cross/index.js';
import { createSmaCrossStrategy } from '../research/strategies/sma-cross/index.js';
import { createDonchianBreakoutStrategy } from '../research/strategies/donchian-breakout/index.js';
import type { Candle, Strategy, Signal } from '../core/types.js';
import { PaperExecutor, Executor } from './executor.js';
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
	mae: number; // Max Adverse Excursion (Max drawdown observed)
	mfe: number; // Max Favorable Excursion (Max run-up observed)
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
	exitReason: string; // 'TP' | 'SL' | 'Signal' | 'Time Exit'
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
}

// ─── ExecutionEngine Singleton & Service ────────────────────────────────────

export class ExecutionEngine {
	private state: EngineState;
	private executor: Executor;
	private ws: WebSocket | null = null;
	private timer: NodeJS.Timeout | null = null;
	private candlesMap = new Map<string, Candle[]>();
	private statePath: string;
	private strategyPath: string;
	private coins: string[];
	private interval: string;
	private onUpdateCallback: ((state: EngineState) => void) | null = null;

	constructor(coins: string[], interval: string, strategyPath: string) {
		this.coins = coins;
		this.interval = interval;
		this.strategyPath = strategyPath;
		this.statePath = join(process.cwd(), 'results', 'live_paper_state.json');
		this.executor = new PaperExecutor();

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

		log(`Live ExecutionEngine is starting...`);
		this.state.engineStatus = 'running';
		this.state.startTime = new Date().toISOString();
		this.state.uptime = 0;
		this.state.heartbeat = new Date().toISOString();

		// 1) Bootstrap Candle history from Binance REST API in parallel
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

		// 2) Establish WebSocket connection to Binance Kline stream
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

		this.ws.on('message', (data: string) => {
			try {
				const msg = JSON.parse(data);
				if (msg.e === 'kline') {
					this.handleKlineTick(msg.s, msg.k);
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

	private handleKlineTick(coin: string, k: any): void {
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
		this.checkRiskExits(coin, price, k.T);

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
			this.evaluateStrategySignals(coin, list, closedCandle);
		}

		this.updatePortfolioEquity();
	}

	private checkRiskExits(coin: string, price: number, timestamp: number): void {
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
			this.closePosition(pos, exitPrice, reason, timestamp);
			this.state.activePositions.splice(idx, 1);
		}
	}

	private evaluateStrategySignals(coin: string, candles: Candle[], lastCandle: Candle): void {
		try {
			// Resolve strategy dynamically
			const strategy = this.resolveStrategy(this.strategyPath, candles);
			const signals = strategy.evaluate(candles);

			// Find last signal matching this closed candle's openTime
			const activeSignal = signals.find(s => s.timestamp === lastCandle.openTime);
			if (!activeSignal) return;

			log(`[${coin}] Strategy Generated Signal: ${activeSignal.side} | Reason: ${activeSignal.reason}`);

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
					const fill = this.executor.buy(coin, lastCandle.close, budget, lastCandle.closeTime);
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

					log(`[${coin}] Paper Position Opened. Qty: ${fill.quantity.toFixed(4)} | Entry: ${fill.price}`);
				}
			} else if (activeSignal.side === 'SELL' && hasPosition) {
				const idx = this.state.activePositions.findIndex(p => p.coin === coin);
				if (idx !== -1) {
					const pos = this.state.activePositions[idx];
					this.closePosition(pos, lastCandle.close, 'Signal', lastCandle.closeTime);
					this.state.activePositions.splice(idx, 1);
				}
			}
		} catch (e) {
			logError(`Failed running strategy evaluator on closed bar: ${e}`);
		}
	}

	private closePosition(pos: ActivePosition, exitPrice: number, reason: string, timestamp: number): void {
		const fill = this.executor.sell(pos.coin, exitPrice, pos.quantity, timestamp);
		const grossReturn = pos.quantity * fill.price;
		const proceeds = grossReturn - fill.commission;
		this.state.cash += proceeds;

		const realizedPnLUsdt = proceeds - pos.positionSizeUsdt;
		const realizedPnLPercent = (fill.price - pos.entryPrice) / pos.entryPrice * 100;
		this.state.realizedPnL += realizedPnLUsdt;

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
		log(`[${pos.coin}] Paper Position Closed via ${reason}. Exit Price: ${fill.price} | PnL: ${realizedPnLUsdt.toFixed(2)} USDT (${realizedPnLPercent.toFixed(2)}%)`);
	}

	private resolveStrategy(strategyPath: string, candles: Candle[]): Strategy {
		if (strategyPath.endsWith('.json') || existsSync(strategyPath)) {
			const raw = readFileSync(strategyPath, 'utf-8');
			const configJson = JSON.parse(raw) as StrategyConfig;
			return createStrategyFromConfig(configJson, candles).strategy;
		}

		if (strategyPath === 'ema-cross') return createEmaCrossStrategy();
		if (strategyPath === 'sma-cross') return createSmaCrossStrategy();
		if (strategyPath === 'donchian-breakout') return createDonchianBreakoutStrategy();

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

let activeEngine: ExecutionEngine | null = null;

export async function startExecutionEngine(coins: string[], interval: string, strategyPath: string, cb: (state: EngineState) => void): Promise<ExecutionEngine> {
	if (activeEngine) {
		activeEngine.stop();
	}
	activeEngine = new ExecutionEngine(coins, interval, strategyPath);
	activeEngine.registerUpdateCallback(cb);
	await activeEngine.start();
	return activeEngine;
}

export function stopExecutionEngine(): void {
	if (activeEngine) {
		activeEngine.stop();
		activeEngine = null;
	}
}

export function getExecutionEngineState(): EngineState | null {
	if (activeEngine) {
		return activeEngine.getState();
	}
	const statePath = join(process.cwd(), 'results', 'live_paper_state.json');
	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, 'utf-8');
			return JSON.parse(raw) as EngineState;
		} catch {}
	}
	return null;
}
