// ============================================================================
// KRIPTOQUANT — Live Execution Engine (Temmuz 2026 Overhaul)
// ============================================================================
// Tasarım ilkeleri:
// 1. Canlı motor, backtest motoruyla AYNI kural yapısını kullanır:
//    giriş = strateji sinyali, çıkış = SL / TP / karşıt sinyal.
//    Strateji-özel gizli kâr-kilitleme katmanları YOKTUR.
// 2. Dolumlar gerçekçidir: stop tetiklendiğinde gözlenen tik fiyatından
//    (slipaj broker'da) satılır; stop fiyatından "hayali" dolum yapılmaz.
// 3. Risk kapıları: günlük zarar kill-switch, eşzamanlı pozisyon limiti,
//    BTC rejim filtresi. Hepsi config/risk.json üzerinden yönetilir.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createStrategyFromConfig } from '../research/strategies/factory/index.js';
import type { StrategyConfig } from '../research/strategies/factory/types.js';
import { createEmaCrossStrategy } from '../research/strategies/ema-cross/index.js';
import { createDonchianBreakoutStrategy } from '../research/strategies/donchian-breakout/index.js';
import { createA2V2Strategy } from '../research/strategies/a2-v2/index.js';
import { createVwapReversionStrategy } from '../research/strategies/vwap-reversion/index.js';
import { createRandomStrategy } from '../research/strategies/random/index.js';
import { atr, sma } from '../core/indicators/index.js';
import type { Candle, Strategy } from '../core/types.js';
import { BinanceTrBroker } from '../execution/binance-tr-broker.js';
import { log, logError } from '../core/utils.js';

// ─── Canlı Risk Konfigürasyonu ──────────────────────────────────────────────

export interface LiveRiskConfig {
	riskPerTradePercent: number; // İşlem başına hedeflenen sermaye riski (%)
	maxPositionPercent: number; // Tek pozisyonun sermayeye oranı tavanı (%)
	maxOrderValue: number; // Tek emrin mutlak USDT tavanı
	maxConcurrentPositions: number; // Aynı anda açık pozisyon sayısı limiti
	maxDailyLossPercent: number; // Günlük zarar kill-switch eşiği (%)
	stopLossAtrMultiplier: number; // Strateji SL vermezse: SL = giriş - N*ATR
	enableBtcRegimeFilter: boolean; // BTC 4h 200-SMA rejim filtresi
}

const DEFAULT_LIVE_RISK: LiveRiskConfig = {
	riskPerTradePercent: 0.5,
	maxPositionPercent: 15,
	maxOrderValue: 2000,
	maxConcurrentPositions: 4,
	maxDailyLossPercent: 3,
	stopLossAtrMultiplier: 2,
	enableBtcRegimeFilter: true,
};

export function loadLiveRiskConfig(): LiveRiskConfig {
	try {
		const raw = readFileSync(join(process.cwd(), 'config', 'risk.json'), 'utf-8');
		const parsed = JSON.parse(raw);
		return { ...DEFAULT_LIVE_RISK, ...parsed };
	} catch (e) {
		logError(`config/risk.json okunamadı, varsayılan risk limitleri kullanılıyor: ${e}`);
		return { ...DEFAULT_LIVE_RISK };
	}
}

// ─── BTC Rejim Monitörü (paylaşımlı singleton) ──────────────────────────────
// BTC 4h kapanışı 200-SMA üzerindeyse RISK_ON, altındaysa RISK_OFF.
// Veri alınamazsa UNKNOWN — motor bu durumda girişleri engellemez (fail-open),
// ama loglar. 15 dakikada bir tazelenir.

export type BtcRegime = 'RISK_ON' | 'RISK_OFF' | 'UNKNOWN';

class BtcRegimeMonitor {
	private regime: BtcRegime = 'UNKNOWN';
	private lastFetch = 0;
	private fetching = false;
	private static REFRESH_MS = 15 * 60 * 1000;

	public getRegime(): BtcRegime {
		this.refreshIfStale();
		return this.regime;
	}

	private refreshIfStale(): void {
		const now = Date.now();
		if (this.fetching || now - this.lastFetch < BtcRegimeMonitor.REFRESH_MS) return;
		this.fetching = true;
		this.fetchRegime()
			.then((r) => {
				if (r !== this.regime) {
					log(`[BTC Rejim] Değişti: ${this.regime} → ${r}`);
				}
				this.regime = r;
				this.lastFetch = Date.now();
			})
			.catch((e) => {
				logError(`[BTC Rejim] Veri alınamadı (mevcut: ${this.regime}): ${e}`);
				this.lastFetch = Date.now(); // hata durumunda da bekle, API'yi dövme
			})
			.finally(() => {
				this.fetching = false;
			});
	}

	private async fetchRegime(): Promise<BtcRegime> {
		const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=210';
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as any[];
		if (!Array.isArray(data) || data.length < 200) return 'UNKNOWN';
		const closes = data.map((d) => parseFloat(d[4]));
		const smaValues = sma(closes, 200);
		const lastSma = smaValues[smaValues.length - 1];
		const lastClose = closes[closes.length - 1];
		if (!Number.isFinite(lastSma) || Number.isNaN(lastSma)) return 'UNKNOWN';
		return lastClose > lastSma ? 'RISK_ON' : 'RISK_OFF';
	}
}

export const btcRegimeMonitor = new BtcRegimeMonitor();

// ─── State Tipleri ──────────────────────────────────────────────────────────

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
	initialAtr?: number;
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
	// Günlük kill-switch takibi
	tradingDay?: string; // UTC gün (YYYY-MM-DD)
	dayStartEquity?: number; // Gün başındaki sermaye
	entriesHalted?: boolean; // Günlük zarar limiti aşıldı, yeni giriş yok
	btcRegime?: BtcRegime; // Son bilinen BTC rejimi (dashboard için)
}

// ─── ExecutionEngine ────────────────────────────────────────────────────────

export class ExecutionEngine {
	private state: EngineState;
	private broker: BinanceTrBroker;
	private timer: NodeJS.Timeout | null = null;
	private candlesMap = new Map<string, Candle[]>();
	private statePath: string;
	private strategyPath: string;
	private coins: string[];
	private interval: string;
	private riskConfig: LiveRiskConfig;
	private haltLogged = false;
	private regimeBlockLogged = false;
	private onUpdateCallback: ((state: EngineState) => void) | null = null;

	public getCoins(): string[] {
		return this.coins;
	}

	constructor(coins: string[], interval: string, strategyPath: string) {
		this.coins = coins;
		this.interval = interval;
		this.strategyPath = strategyPath;
		this.statePath = join(process.cwd(), 'results', `live_paper_state_${strategyPath}_${interval}.json`);
		this.broker = new BinanceTrBroker();
		this.riskConfig = loadLiveRiskConfig();

		this.state = this.loadSavedState();
	}

	private loadSavedState(): EngineState {
		if (existsSync(this.statePath)) {
			try {
				const raw = readFileSync(this.statePath, 'utf-8');
				const parsed = JSON.parse(raw) as EngineState;
				parsed.engineStatus = 'stopped';
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

		// Çoklu motor aynı anda açılırken Binance rate limitini korumak için rastgele gecikme
		const startupDelay = skipDelay ? 0 : Math.random() * 8000;
		if (startupDelay > 0) {
			log(`ExecutionEngine start called. Delaying boot by ${(startupDelay / 1000).toFixed(2)}s to protect Binance Rate Limits...`);
			await new Promise((resolve) => setTimeout(resolve, startupDelay));
		}

		log(`Live ExecutionEngine is starting... [${this.strategyPath} @ ${this.interval}]`);
		this.state.engineStatus = 'running';
		this.state.startTime = new Date().toISOString();
		this.state.uptime = 0;
		this.state.heartbeat = new Date().toISOString();
		this.state.coins = this.coins;
		this.state.interval = this.interval;
		this.state.strategyPath = this.strategyPath;

		// Warmup periyodunu bir kez çözerek belirle
		let warmupPeriod = 200;
		try {
			const dummyCandles: Candle[] = Array.from({ length: 1000 }, () => ({
				openTime: Date.now(),
				open: 100,
				high: 100,
				low: 100,
				close: 100,
				volume: 100,
				closeTime: Date.now() + 60000,
			}));
			const dummyStrategy = this.resolveStrategy(this.strategyPath, dummyCandles);
			warmupPeriod = dummyStrategy.warmupPeriod || 200;
		} catch (e) {
			logError(`Failed to determine warmup period: ${e}`);
		}

		// 1) Geçmiş mumları REST'ten yükle (indikatör ısınması için)
		const historyLimit = Math.max(200, warmupPeriod + 50);
		log(`Bootstrapping historical candles for ${this.coins.join(', ')} (limit = ${historyLimit})...`);
		for (const coin of this.coins) {
			try {
				const history = await this.fetchHistory(coin, this.interval, historyLimit);
				this.candlesMap.set(coin, history);
				log(`  ✓ Loaded ${history.length} candles for ${coin}`);
				await new Promise((resolve) => setTimeout(resolve, 150));
			} catch (e) {
				logError(`Failed to bootstrap history for ${coin}: ${e}`);
				this.candlesMap.set(coin, []);
			}
		}

		// 1b) Motor kapalıyken stop seviyesi delinmiş pozisyonları kapat.
		// Not: Stop fiyatından değil, şu an gözlenen fiyattan kapatılır — motor
		// kapalıyken emir borsada olmadığı için stop fiyatı garantisi yoktur.
		await this.closeGappedPositions();

		// 2) Paylaşımlı WebSocket akışına kaydol
		sharedStreamManager.register(this.interval, this.coins, this);

		// 3) Uptime & heartbeat zamanlayıcısı
		this.timer = setInterval(() => {
			if (this.state.engineStatus === 'running') {
				this.state.uptime += 1;
				this.state.heartbeat = new Date().toISOString();
				this.rollTradingDayIfNeeded();
				this.updatePortfolioEquity();
				this.broadcast();

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
		const data = (await res.json()) as any[];
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

	/** Motor kapalıyken SL altına düşmüş pozisyonları mevcut fiyattan tasfiye eder. */
	private async closeGappedPositions(): Promise<void> {
		const toClose: { pos: ActivePosition; price: number }[] = [];
		for (const pos of this.state.activePositions) {
			const candles = this.candlesMap.get(pos.coin);
			if (!candles || candles.length === 0) continue;
			const lastClose = candles[candles.length - 1].close;
			if (lastClose <= pos.stopLoss) {
				toClose.push({ pos, price: lastClose });
			}
		}
		for (const { pos, price } of toClose) {
			const ok = await this.closePosition(pos, price, 'SL (restart gap)', Date.now());
			if (ok) {
				const idx = this.state.activePositions.indexOf(pos);
				if (idx !== -1) this.state.activePositions.splice(idx, 1);
			}
		}
	}

	/** UTC gün değiştiyse günlük kill-switch sayaçlarını sıfırlar. */
	private rollTradingDayIfNeeded(): void {
		const today = new Date().toISOString().slice(0, 10);
		if (this.state.tradingDay !== today) {
			this.state.tradingDay = today;
			this.state.dayStartEquity = this.state.currentEquity;
			if (this.state.entriesHalted) {
				log(`[Kill-Switch] Yeni gün (${today}). Girişler tekrar açıldı.`);
			}
			this.state.entriesHalted = false;
			this.haltLogged = false;
		}
	}

	/** Günlük zarar limiti aşıldıysa true döner ve girişleri kilitler. */
	private isDailyLossLimitHit(): boolean {
		const dayStart = this.state.dayStartEquity ?? this.state.currentEquity;
		if (dayStart <= 0) return false;
		const dailyPnLPercent = ((this.state.currentEquity - dayStart) / dayStart) * 100;
		if (dailyPnLPercent <= -this.riskConfig.maxDailyLossPercent) {
			if (!this.haltLogged) {
				log(
					`[Kill-Switch] Günlük zarar limiti aşıldı: ${dailyPnLPercent.toFixed(2)}% <= -${this.riskConfig.maxDailyLossPercent}%. ` +
					`Bugün yeni pozisyon açılmayacak. Açık pozisyonlar SL/TP/sinyal ile yönetilmeye devam eder.`,
				);
				this.haltLogged = true;
			}
			this.state.entriesHalted = true;
			return true;
		}
		return false;
	}

	private async handleKlineTick(coin: string, k: any): Promise<void> {
		const price = parseFloat(k.c);
		this.state.lastCandleTime = new Date(k.t).toISOString();

		// Her tikte açık pozisyonların PnL/MAE/MFE değerlerini güncelle
		this.state.activePositions.forEach((p) => {
			if (p.coin === coin) {
				p.currentPrice = price;
				p.currentPnLUsdt = (p.currentPrice - p.entryPrice) * p.quantity;
				p.currentPnLPercent = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100;

				if (price > (p.highestPrice ?? p.entryPrice)) {
					p.highestPrice = price;
				}

				const currentDrawdown = p.currentPnLPercent < 0 ? Math.abs(p.currentPnLPercent) : 0;
				const currentRunUp = p.currentPnLPercent > 0 ? p.currentPnLPercent : 0;
				if (currentDrawdown > p.mae) p.mae = currentDrawdown;
				if (currentRunUp > p.mfe) p.mfe = currentRunUp;
			}
		});

		// SL/TP denetimi her tikte
		await this.checkRiskExits(coin, price, k.T);

		// Kapanan mum: strateji değerlendirmesi
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
			if (list.length > 1000) list.shift();
			this.candlesMap.set(coin, list);

			await this.evaluateStrategySignals(coin, list, closedCandle);
		}

		this.updatePortfolioEquity();
	}

	/**
	 * SL/TP denetimi — TÜM stratejiler için tek ve aynı kural seti:
	 * - price <= stopLoss  → gözlenen fiyattan kapat (slipajı broker ekler)
	 * - takeProfit > 0 && price >= takeProfit → gözlenen fiyattan kapat
	 * Backtest motorundaki SL/TP yapısının tik bazlı karşılığıdır.
	 */
	private async checkRiskExits(coin: string, price: number, timestamp: number): Promise<void> {
		const positionsToClose: { idx: number; reason: string; exitPrice: number }[] = [];

		this.state.activePositions.forEach((p, idx) => {
			if (p.coin !== coin) return;

			if (price <= p.stopLoss) {
				// Gerçekçi dolum: stop fiyatı değil, stop'un delindiği anda gözlenen fiyat
				positionsToClose.push({ idx, reason: 'SL', exitPrice: price });
			} else if (p.takeProfit > 0 && price >= p.takeProfit) {
				positionsToClose.push({ idx, reason: 'TP', exitPrice: price });
			}
		});

		for (let i = positionsToClose.length - 1; i >= 0; i--) {
			const { idx, reason, exitPrice } = positionsToClose[i];
			const pos = this.state.activePositions[idx];
			const ok = await this.closePosition(pos, exitPrice, reason, timestamp);
			if (ok) {
				this.state.activePositions.splice(idx, 1);
			}
		}
	}

	private async evaluateStrategySignals(coin: string, candles: Candle[], lastCandle: Candle): Promise<void> {
		try {
			const strategy = this.resolveStrategy(this.strategyPath, candles);
			const signals = strategy.evaluate(candles);

			const activeSignal = signals.find((s) => s.timestamp === lastCandle.openTime);
			if (!activeSignal) return;

			log(`[${coin}] Strategy Generated Signal: ${activeSignal.side} | Reason: ${activeSignal.reason}`);

			this.state.pendingSignals.push({
				coin,
				time: new Date(activeSignal.timestamp).toISOString(),
				side: activeSignal.side,
				price: activeSignal.price,
			});
			if (this.state.pendingSignals.length > 15) this.state.pendingSignals.shift();

			const hasPosition = this.state.activePositions.some((p) => p.coin === coin);

			if (activeSignal.side === 'BUY' && !hasPosition) {
				await this.tryOpenPosition(coin, candles, lastCandle, activeSignal, strategy);
			} else if (activeSignal.side === 'SELL' && hasPosition) {
				const idx = this.state.activePositions.findIndex((p) => p.coin === coin);
				if (idx !== -1) {
					const pos = this.state.activePositions[idx];
					const ok = await this.closePosition(pos, lastCandle.close, 'Signal', lastCandle.closeTime);
					if (ok) {
						this.state.activePositions.splice(idx, 1);
					}
				}
			}
		} catch (e) {
			logError(`Failed running strategy evaluator on closed bar: ${e}`);
		}
	}

	private async tryOpenPosition(
		coin: string,
		candles: Candle[],
		lastCandle: Candle,
		activeSignal: { price: number; stopLoss?: number; takeProfit?: number; metadata?: any },
		strategy: Strategy,
	): Promise<void> {
		// ── Risk Kapısı 1: Günlük zarar kill-switch ──
		if (this.isDailyLossLimitHit()) return;

		// ── Risk Kapısı 2: Eşzamanlı pozisyon limiti ──
		if (this.state.activePositions.length >= this.riskConfig.maxConcurrentPositions) {
			log(`[${coin}] Sinyal atlandı: eşzamanlı pozisyon limiti dolu (${this.riskConfig.maxConcurrentPositions}).`);
			return;
		}

		// ── Risk Kapısı 3: BTC rejim filtresi ──
		if (this.riskConfig.enableBtcRegimeFilter) {
			const regime = btcRegimeMonitor.getRegime();
			this.state.btcRegime = regime;
			if (regime === 'RISK_OFF') {
				if (!this.regimeBlockLogged) {
					log(`[BTC Rejim] RISK_OFF (BTC 4h < 200-SMA). Yeni long girişleri engelleniyor.`);
					this.regimeBlockLogged = true;
				}
				return;
			}
			this.regimeBlockLogged = false;
		}

		const entryPrice = lastCandle.close;

		// SL: önce strateji metadata'sı; yoksa backtest ile aynı ATR kuralı
		let stopLossPrice = activeSignal.stopLoss ?? activeSignal.metadata?.sl;
		let initialAtr: number | undefined = activeSignal.metadata?.atr;
		if (stopLossPrice === undefined || stopLossPrice <= 0) {
			const atrValues = candles.length >= 15 ? atr(candles, 14) : [];
			const lastAtr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : Number.NaN;
			if (Number.isFinite(lastAtr) && !Number.isNaN(lastAtr) && lastAtr > 0) {
				stopLossPrice = entryPrice - lastAtr * this.riskConfig.stopLossAtrMultiplier;
				initialAtr = lastAtr;
			} else {
				stopLossPrice = entryPrice * 0.97; // ATR hesaplanamazsa muhafazakâr %3 stop
			}
		}

		// TP: strateji vermediyse TP YOK (trend stratejileri karşıt sinyalle çıkar).
		const takeProfitPrice = activeSignal.takeProfit ?? activeSignal.metadata?.tp ?? 0;

		// ── Pozisyon boyutlandırma ──
		// Hedef: sermayenin riskPerTradePercent'i kadar risk; tavanlar:
		// maxPositionPercent, maxOrderValue ve eldeki nakit.
		const totalEquity = this.state.currentEquity || this.state.cash;
		const riskAmount = totalEquity * (this.riskConfig.riskPerTradePercent / 100);
		const stopDistance = Math.abs(entryPrice - stopLossPrice) / entryPrice;
		const stopDistancePercent = stopDistance > 0 ? stopDistance : 0.02;

		let budget = riskAmount / stopDistancePercent;
		budget = Math.min(
			budget,
			totalEquity * (this.riskConfig.maxPositionPercent / 100),
			this.riskConfig.maxOrderValue,
			this.state.cash,
		);

		if (budget < 10) return;

		let fill;
		try {
			fill = await this.broker.buy(coin, lastCandle.closeTime, lastCandle.close, budget);
		} catch (e) {
			logError(`[${coin}] ALIM emri başarısız, pozisyon açılmadı: ${e}`);
			return;
		}
		this.state.cash -= budget;

		const riskPercent = Math.abs(((fill.price - stopLossPrice) / fill.price) * 100);
		const actualRiskUsdt = budget * (riskPercent / 100);

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
			initialAtr,
		});

		log(
			`[🤖 ${strategy.name.toUpperCase()}] [${coin}] Pozisyon AÇILDI. Miktar: ${fill.quantity.toFixed(4)} | ` +
			`Giriş: $${fill.price.toFixed(4)} | Bütçe: $${budget.toFixed(2)} (${((budget / totalEquity) * 100).toFixed(1)}% sermaye) | ` +
			`SL: $${stopLossPrice.toFixed(4)} | Gerçek risk: $${actualRiskUsdt.toFixed(2)} (sermayenin %${((actualRiskUsdt / totalEquity) * 100).toFixed(2)}'i)`,
		);
	}

	/**
	 * Pozisyonu kapatır. Emir başarısız olursa pozisyona DOKUNMAZ ve false döner —
	 * bir sonraki tikte tekrar denenir. (Sessiz sahte dolum yasak.)
	 */
	private async closePosition(pos: ActivePosition, exitPrice: number, reason: string, timestamp: number): Promise<boolean> {
		let fill;
		try {
			fill = await this.broker.sell(pos.coin, timestamp, exitPrice, pos.quantity);
		} catch (e) {
			logError(`[${pos.coin}] SATIM emri başarısız (${reason}), pozisyon korunuyor, tekrar denenecek: ${e}`);
			return false;
		}

		const grossReturn = pos.quantity * fill.price;
		const proceeds = grossReturn - fill.commission;
		this.state.cash += proceeds;

		const realizedPnLUsdt = proceeds - pos.positionSizeUsdt;
		const realizedPnLPercent = ((fill.price - pos.entryPrice) / pos.entryPrice) * 100;
		this.state.realizedPnL += realizedPnLUsdt;

		const entryTimeMs = new Date(pos.entryTime).getTime();
		const durationSeconds = Math.max(1, Math.round((timestamp - entryTimeMs) / 1000));

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
		log(
			`[🤖 ${pos.strategyName.toUpperCase()}] [${pos.coin}] Pozisyon KAPATILDI (${reason}). ` +
			`Giriş: $${pos.entryPrice.toFixed(4)} | Çıkış: $${fill.price.toFixed(4)} | Net PnL: $${realizedPnLUsdt.toFixed(2)} (${realizedPnLPercent.toFixed(2)}%)`,
		);
		return true;
	}

	private resolveStrategy(strategyPath: string, candles: Candle[]): Strategy {
		if (strategyPath.endsWith('.json') || existsSync(strategyPath)) {
			const raw = readFileSync(strategyPath, 'utf-8');
			const configJson = JSON.parse(raw) as StrategyConfig;
			return createStrategyFromConfig(configJson, candles).strategy;
		}

		// Canlı test kadrosu (Temmuz 2026): 2 mean-reversion + 2 trend + 1 baseline
		if (strategyPath === 'a2-v2') return createA2V2Strategy();
		if (strategyPath === 'vwap-reversion') return createVwapReversionStrategy();
		if (strategyPath === 'donchian-breakout') return createDonchianBreakoutStrategy();
		if (strategyPath === 'ema-cross') return createEmaCrossStrategy();
		if (strategyPath === 'random') return createRandomStrategy();

		throw new Error(
			`Strategy resolver failed: "${strategyPath}". ` +
			`Canlı kadro: a2-v2, vwap-reversion, donchian-breakout, ema-cross, random (veya bir factory .json yolu).`,
		);
	}

	private updatePortfolioEquity(): void {
		let unrealized = 0;
		this.state.activePositions.forEach((p) => {
			unrealized += p.currentPnLUsdt;
		});

		this.state.unrealizedPnL = unrealized;
		this.state.currentEquity = this.state.cash + posTotalValue(this.state.activePositions) + unrealized;

		const nowStr = new Date().toISOString().substring(11, 19);
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
	positions.forEach((p) => {
		total += p.entryPrice * p.quantity;
	});
	return total;
}

// ─── Paylaşımlı WebSocket Akış Yöneticisi ───────────────────────────────────

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

		const streams = coins.map((c) => `${c.toLowerCase()}@kline_${interval}`).join('/');
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
								engine.handleSharedKlineTick(coin, k).catch((e) => {
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

// ─── Global singleton yönetimi ──────────────────────────────────────────────

export const activeEngines = new Map<string, ExecutionEngine>();

export async function startExecutionEngine(
	coins: string[],
	interval: string,
	strategyPath: string,
	cb: (state: EngineState) => void,
	skipDelay: boolean = false,
): Promise<ExecutionEngine> {
	const key = `${strategyPath}_${interval}`;
	let engine = activeEngines.get(key);
	if (engine) {
		engine.stop();
	}
	engine = new ExecutionEngine(coins, interval, strategyPath);
	engine.registerUpdateCallback(cb);
	await engine.start(skipDelay);
	activeEngines.set(key, engine);
	return engine;
}

// API polling sırasında disk okumasını engellemek için in-memory state cache
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
		stateCache.set(key, state);
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

	if (existsSync(statePath)) {
		try {
			const raw = readFileSync(statePath, 'utf-8');
			const parsed = JSON.parse(raw) as EngineState;
			if (parsed.coins && Array.isArray(parsed.coins)) coins = parsed.coins;
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
		equityCurveLive: [{ time: new Date().toLocaleTimeString(), equity: 10000 }],
		heartbeat: new Date().toISOString(),
		lastCandleTime: '',
		coins,
		strategyPath,
	} as any;

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

// Canlı test kadrosu — dashboard bu listeyi gösterir.
export const LIVE_STRATEGY_ROSTER = [
	{ name: 'a2-v2', label: 'A2 Bollinger v2 (MR + ADX)', interval: '15m' },
	{ name: 'vwap-reversion', label: 'VWAP Reversion (MR)', interval: '15m' },
	{ name: 'donchian-breakout', label: 'Donchian Breakout (Trend)', interval: '4h' },
	{ name: 'ema-cross', label: 'EMA Crossover (Trend)', interval: '4h' },
	{ name: 'random', label: 'Random Walk Baseline', interval: '15m' },
] as const;

export function getAllExecutionEnginesSummary(): StrategySummary[] {
	return LIVE_STRATEGY_ROSTER.map((strat) => {
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
				(state.activePositions || []).forEach((p) => {
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
			activeIntervals,
		};
	});
}
