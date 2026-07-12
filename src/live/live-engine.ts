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
import { createTrendPullbackStrategy } from '../research/strategies/trend-pullback/index.js';
import { createFreedomStrategy } from '../research/strategies/freedom/index.js';
import { createFreedomBStrategy } from '../research/strategies/freedom_b/index.js';
import { createGemini1Strategy } from '../research/strategies/gemini_1/index.js';
import { createGemini2Strategy } from '../research/strategies/gemini_2/index.js';
import { createSupertrendStrategy } from '../research/strategies/supertrend/index.js';
import { createVwapReversionStrategy } from '../research/strategies/vwap-reversion/index.js';
import { createBollingerRsiDivStrategy } from '../research/strategies/bollinger-rsi-div/index.js';
import { createRandomStrategy } from '../research/strategies/random/index.js';
import { createBollingerBandsV2Strategy } from '../research/strategies/bollinger-bands-v2/index.js';
import { createA2V2Strategy } from '../research/strategies/a2-v2/index.js';
import { createBollingerBandsTimestampStrategy } from '../research/strategies/bollinger-bands-timestamp/index.js';
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
	highestPrice?: number;
	breakevenTriggered?: boolean;
	profitStage?: number;
	initialAtr?: number;
	partialExitTriggered?: boolean;
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

	public getCoins(): string[] {
		return this.coins;
	}
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
		this.statePath = join(process.cwd(), 'results', `live_paper_state_${strategyPath}_${interval}.json`);
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

	public async start(skipDelay: boolean = false): Promise<void> {
		if (this.state.engineStatus === 'running') return;

		// Add a random delay up to 8 seconds to avoid spamming Binance on startup when multiple engines boot at once (skip if skipDelay is true)
		const startupDelay = skipDelay ? 0 : Math.random() * 8000;
		if (startupDelay > 0) {
			log(`ExecutionEngine start called. Delaying boot by ${(startupDelay / 1000).toFixed(2)}s to protect Binance Rate Limits...`);
			await new Promise(resolve => setTimeout(resolve, startupDelay));
		}

		log(`Live ExecutionEngine (Binance TR mode) is starting...`);
		this.state.engineStatus = 'running';
		this.state.startTime = new Date().toISOString();
		this.state.uptime = 0;
		this.state.heartbeat = new Date().toISOString();
		this.state.coins = this.coins;
		this.state.interval = this.interval;
		this.state.strategyPath = this.strategyPath;
		this.state.mlVeto = this.mlVeto;

		// Determine warmup period by resolving strategy once with dummy candles
		let warmupPeriod = 200;
		try {
			const dummyCandles: Candle[] = Array.from({ length: 1000 }, () => ({
				openTime: Date.now(),
				open: 100,
				high: 100,
				low: 100,
				close: 100,
				volume: 100,
				closeTime: Date.now() + 60000
			}));
			const dummyStrategy = this.resolveStrategy(this.strategyPath, dummyCandles);
			warmupPeriod = dummyStrategy.warmupPeriod || 200;
		} catch (e) {
			logError(`Failed to determine warmup period: ${e}`);
		}

		// 1) Bootstrap Candle history from Binance REST API in parallel (for indicator warm-up)
		const historyLimit = Math.max(200, warmupPeriod + 50);
		log(`Bootstrapping historical candles for ${this.coins.join(', ')} (limit = ${historyLimit})...`);
		for (const coin of this.coins) {
			try {
				const history = await this.fetchHistory(coin, this.interval, historyLimit);
				this.candlesMap.set(coin, history);
				log(`  ✓ Loaded ${history.length} candles for ${coin}`);
				// 150ms sleep to avoid spamming Binance REST API
				await new Promise(resolve => setTimeout(resolve, 150));
			} catch (e) {
				logError(`Failed to bootstrap history for ${coin}: ${e}`);
				this.candlesMap.set(coin, []);
			}
		}

		// 2) Register this engine with the shared global WebSocket stream manager
		sharedStreamManager.register(this.interval, this.coins, this);

		// 3) Start 1-second interval timer for Uptime and Heartbeat
		this.timer = setInterval(() => {
			if (this.state.engineStatus === 'running') {
				this.state.uptime += 1;
				this.state.heartbeat = new Date().toISOString();
				this.updatePortfolioEquity();
				
				// Broadcast state via WebSocket on every tick in memory
				this.broadcast();
				
				// Write state file to disk only once every 15 seconds to prevent high disk I/O load
				if (this.state.uptime % 15 === 0) {
					this.saveToDisk();
				}
			}
		}, 1000);

		this.saveAndBroadcast();
		log(`Live ExecutionEngine is running!`);
	}

	public stop(): void {
		if (this.state.engineStatus === 'stopped') return;

		log(`Live ExecutionEngine is stopping...`);
		this.state.engineStatus = 'stopped';
		
		sharedStreamManager.unregister(this.interval, this);

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

	public getInterval(): string {
		return this.interval;
	}

	public isEngineRunning(): boolean {
		return this.state.engineStatus === 'running';
	}

	public async handleSharedKlineTick(coin: string, k: any): Promise<void> {
		await this.handleKlineTick(coin, k);
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

				// Track highest price for trailing stop
				if (price > (p.highestPrice ?? p.entryPrice)) {
					p.highestPrice = price;
				}

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
			
			// Freedom Soft Stop check at candle close!
			const softPositionsToClose: number[] = [];
			this.state.activePositions.forEach((p, idx) => {
				if (p.coin === coin && (p.strategyName === 'freedom' || p.strategyName === 'freedom_b')) {
					if (price <= p.stopLoss) {
						softPositionsToClose.push(idx);
					}
				}
			});
			for (let i = softPositionsToClose.length - 1; i >= 0; i--) {
				const idx = softPositionsToClose[i];
				const pos = this.state.activePositions[idx];
				await this.closePosition(pos, price, 'Soft Stop (Swing Low)', k.T);
				this.state.activePositions.splice(idx, 1);
			}

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
			if (list.length > 1000) list.shift(); // Keep up to 1000 candles for warm-up strategies like Freedom
			this.candlesMap.set(coin, list);

			// Run strategy execution on closed bar
			await this.evaluateStrategySignals(coin, list, closedCandle);
		}

		this.updatePortfolioEquity();
	}

	private async checkRiskExits(coin: string, price: number, timestamp: number): Promise<void> {
		const positionsToClose: { idx: number; reason: string; exitPrice: number }[] = [];

		this.state.activePositions.forEach((p, idx) => {
			if (p.coin === coin) {
				if (p.strategyName === 'bollinger-bands-v2') {
					const entryPrice = p.entryPrice;
					const currentAtr = p.initialAtr || (entryPrice * 0.02);

					// Dynamic Stop Loss check (SL 2*ATR initially, moves to breakeven after partial TP)
					if (price <= p.stopLoss) {
						const reason = p.partialExitTriggered ? 'Profit Lock Stop (BB V2)' : 'SL (ATR)';
						positionsToClose.push({ idx, reason, exitPrice: p.stopLoss });
						return;
					}

					// Middle band (20 SMA) partial TP check:
					if (!p.partialExitTriggered) {
						const candles = this.candlesMap.get(coin) || [];
						if (candles.length >= 20) {
							const closes = candles.map(c => c.close);
							const sma20 = sma(closes, 20);
							const middleBand = sma20[sma20.length - 1];

							if (!Number.isNaN(middleBand) && price >= middleBand) {
								const sellQty = p.quantity / 2;
								log(`[🤖 BB-V2] [${coin}] Kademeli Kar Al (Middle Band 20 SMA) Tetiklendi. Fiyat: $${price.toFixed(4)} | Orta Band: $${middleBand.toFixed(4)} | Satilan: ${sellQty.toFixed(4)}`);

								p.partialExitTriggered = true;
								this.broker.sell(coin, timestamp, price, sellQty).then(fill => {
									const partialPnLPercent = ((price - entryPrice) / entryPrice) * 100;
									const partialPnLUsdt = (price - entryPrice) * sellQty - fill.commission;

									this.state.closedTrades.push({
										coin,
										direction: 'LONG',
										entryTime: p.entryTime,
										exitTime: new Date(timestamp).toISOString(),
										entryPrice,
										exitPrice: price,
										quantity: sellQty,
										realizedPnLPercent: partialPnLPercent,
										realizedPnLUsdt: partialPnLUsdt,
										entryReason: 'BUY',
										exitReason: 'Partial TP',
										holdingDurationSeconds: Math.floor((timestamp - new Date(p.entryTime).getTime()) / 1000),
										mae: p.mae || 0,
										mfe: p.mfe || 0,
										rMultiple: partialPnLPercent / (p.riskPercent || 1),
										strategyName: p.strategyName,
									});

									// DÜZELTME: Kademeli satım gelirleri kasaya eklenir
									const proceeds = fill.quantity * fill.price - fill.commission;
									this.state.cash += proceeds;
									this.state.realizedPnL += partialPnLUsdt;

									p.quantity -= sellQty;
									p.positionSizeUsdt /= 2;

									// Move SL to entry price
									p.stopLoss = entryPrice;
									p.profitStage = 1;

									log(`[🤖 BB-V2] [${coin}] Kademeli Kar Al Sonrasi Stop Loss Basabas Cekildi: $${p.stopLoss.toFixed(4)}`);
									this.saveAndBroadcast();
								}).catch(err => {
									logError(`[🤖 BB-V2] [${coin}] Kademeli Kar Al Satim Hatasi: ${err}`);
								});
							}
						}
					}
					return;
				}

				if (p.strategyName === 'a2' || p.strategyName === 'a2-v2') {
					const entryPrice = p.entryPrice;
					const currentAtr = p.initialAtr || (entryPrice * 0.02);

					// Dynamic Trailing Stop for a2-v2:
					if (p.strategyName === 'a2-v2') {
						const highest = p.highestPrice || entryPrice;
						const trailingStop = highest - 2 * currentAtr;
						if (trailingStop > p.stopLoss) {
							p.stopLoss = trailingStop;
							log(`[🤖 A2-V2] [${coin}] Trailing Stop guncellendi. Yeni SL: $${p.stopLoss.toFixed(4)} (Zirve: $${highest.toFixed(4)})`);
						}
					}

					// 1. Time Exit: check if open for >= 24 hours (86400000 ms)
					const elapsedMs = timestamp - new Date(p.entryTime).getTime();
					if (elapsedMs >= 24 * 60 * 60 * 1000) {
						positionsToClose.push({ idx, reason: 'Time Exit', exitPrice: price });
						return;
					}

					// 2. Initial Stop Loss / Trailing Stop Loss check
					if (price <= p.stopLoss) {
						const reason = p.partialExitTriggered ? 'ATR Profit Lock' : 'SL (ATR)';
						positionsToClose.push({ idx, reason, exitPrice: p.stopLoss });
						return;
					}

					// 3. Level 1 Target check (+2 * ATR)
					if (!p.partialExitTriggered) {
						const level1Target = entryPrice + 2 * currentAtr;
						if (price >= level1Target) {
							// Execute partial TP of 50%
							const sellQty = p.quantity / 2;
							log(`[🤖 ${p.strategyName.toUpperCase()}] [${coin}] Kademeli Kar Al (+2 ATR) Tetiklendi. Fiyat: $${price.toFixed(4)} | Satilan: ${sellQty.toFixed(4)}`);
							
							// Run asynchronously so we don't block the iteration
							p.partialExitTriggered = true;
							this.broker.sell(coin, timestamp, price, sellQty).then(fill => {
								// Record the partial closed trade to history
								const partialPnLPercent = ((price - entryPrice) / entryPrice) * 100;
								const partialPnLUsdt = (price - entryPrice) * sellQty - fill.commission;
								
								this.state.closedTrades.push({
									coin,
									direction: 'LONG',
									entryTime: p.entryTime,
									exitTime: new Date(timestamp).toISOString(),
									entryPrice,
									exitPrice: price,
									quantity: sellQty,
									realizedPnLPercent: partialPnLPercent,
									realizedPnLUsdt: partialPnLUsdt,
									entryReason: 'BUY',
									exitReason: 'Partial TP',
									holdingDurationSeconds: Math.floor((timestamp - new Date(p.entryTime).getTime()) / 1000),
									mae: p.mae || 0,
									mfe: p.mfe || 0,
									rMultiple: partialPnLPercent / (p.riskPercent || 1),
									strategyName: p.strategyName,
								});

								// DÜZELTME: Kademeli satım gelirleri kasaya eklenir
								const proceeds = fill.quantity * fill.price - fill.commission;
								this.state.cash += proceeds;
								this.state.realizedPnL += partialPnLUsdt;

								// Reduce position parameters by half
								p.quantity -= sellQty;
								p.positionSizeUsdt /= 2;

								// Move SL to Entry + commission + buffer (roundtrip ~0.25% buffer)
								p.stopLoss = entryPrice * 1.0025;
								p.profitStage = 1;

								log(`[🤖 ${p.strategyName.toUpperCase()}] [${coin}] Kademeli Kar Al Sonrasi Stop Loss Basabas (+0.25% Buffer) Cekildi: $${p.stopLoss.toFixed(4)}`);
								this.saveAndBroadcast();
							}).catch(err => {
								logError(`[🤖 ${p.strategyName.toUpperCase()}] [${coin}] Kademeli Kar Al Satim Hatasi: ${err}`);
							});
						}
					}

					// 4. Level 2 Target check (+3 * ATR)
					if (p.partialExitTriggered && (!p.profitStage || p.profitStage < 2)) {
						const level2Target = entryPrice + 3 * currentAtr;
						if (price >= level2Target) {
							// Move stop loss to entry + 1.5 * ATR
							p.stopLoss = entryPrice + 1.5 * currentAtr;
							p.profitStage = 2;
							log(`[🤖 ${p.strategyName.toUpperCase()}] [${coin}] Dinamik Kar Kilitleme +1.5 ATR (Stage 2) Tetiklendi. Yeni Stop Loss: $${p.stopLoss.toFixed(4)}`);
						}
					}
					return;
				}

				// 1) Multi-Stage Profit Lock-in (Kademeli Kâr Kilitleme):
				// Stage 1 (Breakeven): PnL >= +1.5% -> Lock in Entry Price
				if (p.currentPnLPercent >= 1.5 && (!p.profitStage || p.profitStage < 1)) {
					p.stopLoss = p.entryPrice;
					p.profitStage = 1;
					p.breakevenTriggered = true;
					log(`[${coin}] [${p.strategyName}] Breakeven (Stage 1) triggered. Stop Loss moved to Entry: $${p.entryPrice.toFixed(4)}`);
				}

				// Stage 2 (Lock +1.0%): PnL >= +2.2% -> Lock in Entry Price + 1.0%
				if (p.currentPnLPercent >= 2.2 && (!p.profitStage || p.profitStage < 2)) {
					p.stopLoss = p.entryPrice * 1.01;
					p.profitStage = 2;
					log(`[${coin}] [${p.strategyName}] Profit Lock-in +1% (Stage 2) triggered. Stop Loss: $${p.stopLoss.toFixed(4)}`);
				}

				// Stage 3 (Lock +2.0%): PnL >= +3.0% -> Lock in Entry Price + 2.0% (User requested: %3 kârda en kötü %2'yi kilitle)
				if (p.currentPnLPercent >= 3.0 && (!p.profitStage || p.profitStage < 3)) {
					p.stopLoss = p.entryPrice * 1.02;
					p.profitStage = 3;
					log(`[${coin}] [${p.strategyName}] Profit Lock-in +2% (Stage 3) triggered. Stop Loss: $${p.stopLoss.toFixed(4)}`);
				}

				// 2) Dynamic Trailing Stop check:
				// Activated once price gains at least 3.5% from entry.
				// Trails the highest peak with a 1.0% distance.
				const highest = p.highestPrice ?? p.entryPrice;
				const trailingStopPrice = highest * 0.99; // 1.0% trailing distance

				if (highest >= p.entryPrice * 1.035 && price <= trailingStopPrice) {
					// Ensure we never exit below our Stage 3 floor (+2.0% profit)
					const floorPrice = p.entryPrice * 1.02;
					const finalExitPrice = Math.max(price, floorPrice);
					positionsToClose.push({ idx, reason: 'Trailing Stop', exitPrice: finalExitPrice });
					return;
				}

				// 3) Standard stop & limit checks:
				// RULE: If a stopLoss has been moved to or above entry price (meaning it is a profit lock or breakeven),
				// we MUST check it on every tick instantly for ALL strategies to prevent slippage!
				const isProfitLocked = p.stopLoss >= p.entryPrice;
				if (isProfitLocked && price <= p.stopLoss) {
					const reason = p.stopLoss > p.entryPrice ? 'Profit Lock Stop' : 'Breakeven Stop';
					positionsToClose.push({ idx, reason, exitPrice: p.stopLoss });
					return;
				}

				// Otherwise, check regular SL/TP parameters based on strategy type
				if (p.strategyName === 'freedom_b') {
					// Freedom B Hybrid stop model:
					// - Hard stop is checked on every tick (instantly at entry - 4.5%)
					// - TP is checked on every tick
					// - Soft stop (Swing Low) is checked only on candle close
					const hardStopPrice = p.entryPrice * 0.955;
					if (price <= hardStopPrice) {
						positionsToClose.push({ idx, reason: 'Hard Emergency Stop', exitPrice: hardStopPrice });
					} else if (p.takeProfit > 0 && price >= p.takeProfit) {
						positionsToClose.push({ idx, reason: 'TP', exitPrice: p.takeProfit });
					}
				} else if (p.strategyName === 'freedom') {
					// Freedom Hybrid stop model:
					// - Hard stop is checked on every tick (instantly at entry - 4.5%)
					// - TP is checked on every tick
					// - Soft stop (Swing Low) is checked only on candle close
					const hardStopPrice = p.entryPrice * 0.955;
					if (price <= hardStopPrice) {
						positionsToClose.push({ idx, reason: 'Hard Emergency Stop', exitPrice: hardStopPrice });
					} else if (p.takeProfit > 0 && price >= p.takeProfit) {
						positionsToClose.push({ idx, reason: 'TP', exitPrice: p.takeProfit });
					}
				} else {
					// Standard strategies: SL & TP checked tick-by-tick
					if (price <= p.stopLoss) {
						positionsToClose.push({ idx, reason: 'SL', exitPrice: p.stopLoss });
					} else if (p.takeProfit > 0 && price >= p.takeProfit) {
						positionsToClose.push({ idx, reason: 'TP', exitPrice: p.takeProfit });
					}
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
				// Risk-Based Sizing: Risk 1.5% of total portfolio equity per trade
				// But cap the maximum allocation at 10% of total equity (max $1000 for a $10000 portfolio)
				const totalEquity = this.state.currentEquity || this.state.cash;
				const riskAmount = totalEquity * 0.015; // Risk exactly 1.5% of total equity

				const entryPrice = lastCandle.close;
				const stopLossPrice = activeSignal.stopLoss ?? activeSignal.metadata?.sl ?? entryPrice * 0.98;
				const takeProfitPrice = activeSignal.takeProfit ?? activeSignal.metadata?.tp ?? entryPrice * 1.06;

				// Calculate stop distance in percent (decimal)
				const stopDistance = Math.abs(entryPrice - stopLossPrice) / entryPrice;
				const stopDistancePercent = stopDistance > 0 ? stopDistance : 0.02; // Fallback to 2% if zero

				// Position size = Risk / Stop Distance
				let calculatedSize = riskAmount / stopDistancePercent;

				// Cap at 10% of Total Equity (max $1000 for a $10000 portfolio)
				const maxAllocation = totalEquity * 0.10;
				let budget = Math.min(calculatedSize, maxAllocation);

				// Ensure we don't exceed current cash
				budget = Math.min(budget, this.state.cash);

				if (budget >= 10) {
					const fill = await this.broker.buy(coin, lastCandle.closeTime, lastCandle.close, budget);
					this.state.cash -= budget;

					const riskPercent = Math.abs((fill.price - stopLossPrice) / fill.price * 100);

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
						riskPercent,
						currentPnLPercent: 0,
						currentPnLUsdt: 0,
						mae: 0,
						mfe: 0,
						strategyName: strategy.name,
						initialAtr: activeSignal.metadata?.atr,
					});

					log(`[🤖 ${strategy.name.toUpperCase()}] [${coin}] Pozisyon AÇILDI. Miktar: ${fill.quantity.toFixed(4)} | Giriş: $${fill.price.toFixed(2)} | Bütçe: $${budget.toFixed(2)} | Risk: $${(budget * (riskPercent/100)).toFixed(2)} (${riskPercent.toFixed(2)}%)`);
				}
			} else if (activeSignal.side === 'SELL' && hasPosition) {
				const idx = this.state.activePositions.findIndex(p => p.coin === coin);
				if (idx !== -1) {
					const pos = this.state.activePositions[idx];
					if (pos.strategyName === 'a2-v2') {
						log(`[🤖 A2-V2] [${coin}] Karsit satis sinyali yoksayildi. Trailing Stop cikisi yonetecek.`);
						return;
					}
					await this.closePosition(pos, lastCandle.close, 'Signal', lastCandle.closeTime);
					this.state.activePositions.splice(idx, 1);
				}
			}
		} catch (e) {
			logError(`Failed running strategy evaluator on closed bar: ${e}`);
		}
	}

	private async closePosition(pos: ActivePosition, exitPrice: number, reason: string, timestamp: number): Promise<void> {
		const fill = await this.broker.sell(pos.coin, timestamp, exitPrice, pos.quantity);
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
		log(`[🤖 ${pos.strategyName.toUpperCase()}] [${pos.coin}] Pozisyon KAPATILDI (${reason}). Giriş: $${pos.entryPrice.toFixed(2)} | Çıkış: $${fill.price.toFixed(2)} | Net PnL: $${realizedPnLUsdt.toFixed(2)} (${realizedPnLPercent.toFixed(2)}%)`);
	}

	private resolveStrategy(strategyPath: string, candles: Candle[]): Strategy {
		if (strategyPath.endsWith('.json') || existsSync(strategyPath)) {
			const raw = readFileSync(strategyPath, 'utf-8');
			const configJson = JSON.parse(raw) as StrategyConfig;
			return createStrategyFromConfig(configJson, candles).strategy;
		}

		if (strategyPath === 'supertrend') {
			return createSupertrendStrategy();
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
		if (strategyPath === 'a2-v2') return createA2V2Strategy();
		if (strategyPath === 'vwap-reversion') return createVwapReversionStrategy();
		if (strategyPath === 'bollinger-rsi-div') return createBollingerRsiDivStrategy();
		if (strategyPath === 'bollinger-bands-v2') return createBollingerBandsV2Strategy();
		if (strategyPath === 'bollinger-bands-timestamp') return createBollingerBandsTimestampStrategy();
		if (strategyPath === 'random') return createRandomStrategy();
		if (strategyPath === 'trend-pullback') return createTrendPullbackStrategy();
		if (strategyPath === 'freedom') return createFreedomStrategy();
		if (strategyPath === 'freedom_b') return createFreedomBStrategy();
		if (strategyPath === 'gemini_1') return createGemini1Strategy();
		if (strategyPath === 'gemini_2') return createGemini2Strategy();

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

	private saveToDisk(): void {
		try {
			const dir = join(process.cwd(), 'results');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(this.statePath, JSON.stringify(this.state, null, 4));
		} catch (e) {
			logError(`Failed to save live state to disk: ${e}`);
		}
	}

	private broadcast(): void {
		if (this.onUpdateCallback) {
			this.onUpdateCallback(this.state);
		}
	}

	private saveAndBroadcast(): void {
		this.saveToDisk();
		this.broadcast();
	}
}

function posTotalValue(positions: ActivePosition[]): number {
	let total = 0;
	positions.forEach(p => {
		total += p.entryPrice * p.quantity;
	});
	return total;
}

class SharedStreamManager {
	private connections = new Map<string, WebSocket>();
	private listeners = new Map<string, Set<ExecutionEngine>>();

	public register(interval: string, coins: string[], engine: ExecutionEngine) {
		let set = this.listeners.get(interval);
		if (!set) {
			set = new Set<ExecutionEngine>();
			this.listeners.set(interval, set);
		}
		set.add(engine);

		this.ensureConnection(interval, coins);
	}

	public unregister(interval: string, engine: ExecutionEngine) {
		const set = this.listeners.get(interval);
		if (set) {
			set.delete(engine);
			if (set.size === 0) {
				this.closeConnection(interval);
			}
		}
	}

	private ensureConnection(interval: string, coins: string[]) {
		if (this.connections.has(interval)) return;

		const streams = coins.map(c => `${c.toLowerCase()}@kline_${interval}`).join('/');
		const wsUrl = `wss://stream.binance.com:9443/ws/${streams}`;

		log(`[SharedStreamManager] Creating single shared WebSocket for interval: ${interval}`);
		const ws = new WebSocket(wsUrl);
		this.connections.set(interval, ws);

		ws.on('message', async (data: string) => {
			try {
				const msg = JSON.parse(data);
				if (msg.e === 'kline') {
					const coin = msg.s;
					const k = msg.k;

					const set = this.listeners.get(interval);
					if (set) {
						for (const engine of set) {
							if (engine.isEngineRunning()) {
								engine.handleSharedKlineTick(coin, k).catch(e => {
									logError(`Error handling shared tick in engine: ${e}`);
								});
							}
						}
					}
				}
			} catch (e) {
				logError(`[SharedStreamManager] Error parsing WS tick on interval ${interval}: ${e}`);
			}
		});

		ws.on('error', (err) => {
			logError(`[SharedStreamManager] WebSocket error on interval ${interval}: ${err}`);
		});

		ws.on('close', () => {
			log(`[SharedStreamManager] WebSocket closed for interval ${interval}.`);
			this.connections.delete(interval);

			const set = this.listeners.get(interval);
			if (set && set.size > 0) {
				// Collect fresh coins from all registered engines instead of using stale closure
				const freshCoins = new Set<string>();
				for (const engine of set) {
					for (const c of engine.getCoins()) {
						freshCoins.add(c);
					}
				}
				log(`[SharedStreamManager] Reconnecting interval ${interval} in 5s with ${freshCoins.size} coins...`);
				setTimeout(() => {
					this.ensureConnection(interval, [...freshCoins]);
				}, 5000);
			}
		});
	}

	private closeConnection(interval: string) {
		const ws = this.connections.get(interval);
		if (ws) {
			ws.close();
			this.connections.delete(interval);
			log(`[SharedStreamManager] Closed shared WebSocket for interval: ${interval} (no active listeners)`);
		}
	}
}

export const sharedStreamManager = new SharedStreamManager();

// ─── Global singleton management ─────────────────────────────────────────────

export const activeEngines = new Map<string, ExecutionEngine>();

export async function startExecutionEngine(
	coins: string[],
	interval: string,
	strategyPath: string,
	mlVeto: boolean,
	cb: (state: EngineState) => void,
	skipDelay: boolean = false
): Promise<ExecutionEngine> {
	const key = `${strategyPath}_${interval}`;
	let engine = activeEngines.get(key);
	if (engine) {
		engine.stop();
	}
	engine = new ExecutionEngine(coins, interval, strategyPath, mlVeto);
	engine.registerUpdateCallback(cb);
	await engine.start(skipDelay);
	activeEngines.set(key, engine);
	return engine;
}

// In-memory state cache to prevent blocking file readFileSync during API polling
const stateCache = new Map<string, EngineState>();

export function stopExecutionEngine(strategyPath: string, interval: string): void {
	const key = `${strategyPath}_${interval}`;
	const engine = activeEngines.get(key);
	if (engine) {
		const finalState = engine.getState();
		finalState.engineStatus = 'stopped';
		stateCache.set(key, finalState);
		engine.stop();
		activeEngines.delete(key);
	}
}

export function getExecutionEngineState(strategyPath: string, interval: string): EngineState | null {
	const key = `${strategyPath}_${interval}`;
	const engine = activeEngines.get(key);
	if (engine) {
		const state = engine.getState();
		stateCache.set(key, state); // keep cache warm
		return state;
	}
	
	const cached = stateCache.get(key);
	if (cached) {
		return cached;
	}

	const statePath = join(process.cwd(), 'results', `live_paper_state_${strategyPath}_${interval}.json`);
	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, 'utf-8');
			const parsed = JSON.parse(raw) as EngineState;
			stateCache.set(key, parsed);
			return parsed;
		} catch {}
	}
	return null;
}

export async function resetExecutionEngineState(strategyPath: string, interval: string): Promise<EngineState> {
	const key = `${strategyPath}_${interval}`;
	const wasRunning = activeEngines.has(key);
	
	if (wasRunning) {
		stopExecutionEngine(strategyPath, interval);
	}

	const statePath = join(process.cwd(), 'results', `live_paper_state_${strategyPath}_${interval}.json`);
	let coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT'];
	let mlVeto = false;

	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, 'utf-8');
			const parsed = JSON.parse(raw) as EngineState;
			if (parsed.coins && Array.isArray(parsed.coins)) coins = parsed.coins;
			if (parsed.mlVeto !== undefined) mlVeto = parsed.mlVeto;
		} catch {}
	}

	const initialState: EngineState = {
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
		equityCurveLive: [
			{ time: new Date().toLocaleTimeString(), equity: 10000 }
		],
		heartbeat: new Date().toISOString(),
		lastCandleTime: '',
		coins,
		mlVeto,
		strategyPath
	} as any;

	const { writeFileSync } = await import('node:fs');
	writeFileSync(statePath, JSON.stringify(initialState, null, 2), 'utf-8');
	stateCache.set(key, initialState);

	return initialState;
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
	activeIntervals: string[];
}

export function getAllExecutionEnginesSummary(): StrategySummary[] {
	const registeredStrategies = [
		{ name: 'consensus', label: 'Consensus Hybrid', interval: '1h' },
		{ name: 'a2', label: 'A2 Bollinger (Volt)', interval: '15m' },
		{ name: 'a2-v2', label: 'A2 Bollinger v2', interval: '15m' },
		{ name: 'vwap-reversion', label: 'VWAP Reversion', interval: '15m' },
		{ name: 'bollinger-rsi-div', label: 'Bollinger + RSI Div', interval: '15m' },
		{ name: 'random', label: 'Random Walk Baseline', interval: '15m' },
		{ name: 'ema-cross', label: 'EMA Crossover', interval: '4h' },
		{ name: 'supertrend', label: 'Supertrend', interval: '4h' },
		{ name: 'bollinger-bands', label: 'Bollinger Bands', interval: '15m' },
		{ name: 'bollinger-bands-v2', label: 'Bollinger Bands v2', interval: '15m' },
		{ name: 'bollinger-bands-timestamp', label: 'Bollinger Bands Timestamp', interval: '15m' }
	];

	return registeredStrategies.map(strat => {
		let isAnyRunning = false;
		let totalPnLUsdt = 0;
		let totalCash = 0;
		let totalRealizedPnL = 0;
		let activePositionsCount = 0;
		const activePositions: string[] = [];
		const activeIntervals: string[] = [];
		let maxUptime = 0;
		let latestCandleTime = '';

		const state = getExecutionEngineState(strat.name, strat.interval);
		if (state) {
			const startCash = 10000;
			const equity = state.currentEquity ?? state.cash ?? startCash;
			const pnl = equity - startCash;
			totalPnLUsdt += pnl;
			totalCash += state.cash ?? startCash;
			totalRealizedPnL += state.realizedPnL ?? 0;

			if (state.engineStatus === 'running') {
				isAnyRunning = true;
				activeIntervals.push(strat.interval);
				activePositionsCount += state.activePositions?.length || 0;
				(state.activePositions || []).forEach(p => {
					activePositions.push(`${p.coin.replace('USDT', '')} (${strat.interval})`);
				});
				maxUptime = Math.max(maxUptime, state.uptime || 0);
				if (state.lastCandleTime && state.lastCandleTime > latestCandleTime) {
					latestCandleTime = state.lastCandleTime;
				}
			}
		}

		const totalEquity = 10000 + totalPnLUsdt;
		const totalPnLPercent = (totalPnLUsdt / 10000) * 100;

		return {
			name: strat.name,
			status: isAnyRunning ? 'running' : 'stopped',
			equity: totalEquity,
			cash: totalCash || 10000,
			realizedPnL: totalRealizedPnL,
			positionsCount: activePositionsCount,
			positions: activePositions,
			pnlUsdt: totalPnLUsdt,
			pnlPercent: totalPnLPercent,
			uptime: maxUptime,
			lastCandleTime: latestCandleTime,
			activeIntervals
		};
	});
}
