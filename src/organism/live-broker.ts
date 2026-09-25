import ccxt, { Exchange } from 'ccxt';
import { config } from '../core/config.js';
import { log, logError } from '../core/utils.js';
import { RiskManager } from './risk-manager.js';

export interface LiveOrderResult {
	success: boolean;
	orderId?: string;
	stopOrderId?: string;
	takeProfitOrderId?: string;
	filledPrice?: number;
	filledAmount?: number;
	error?: string;
}

export class LiveBroker {
	private exchange: Exchange;
	private riskManager: RiskManager;
	private liveEnabled: boolean;
	private configuredSymbols = new Set<string>();

	constructor(riskManager?: RiskManager) {
		this.riskManager = riskManager || new RiskManager();
		this.liveEnabled = config.isLiveTradingEnabled && !!config.binance.apiKey;

		this.exchange = new ccxt.binance({
			apiKey: config.binance.apiKey,
			secret: config.binance.secret,
			enableRateLimit: true,
			options: {
				defaultType: 'future', // Binance USDT-M Perpetual Futures
				disableFuturesSandboxWarning: true,
			},
		});

		if (config.binance.useTestnet) {
			this.exchange.setSandboxMode(true);
			log('🟡 [BROKER] Binance Futures TESTNET devrede (Sanal USDT).');
		} else {
			log('🔴 [BROKER] Binance Futures MAINNET devrede (GERÇEK PARA).');
		}

		if (this.liveEnabled) {
			log('🟢 [BROKER] Live Trading AKTİF. Emirler borsaya iletilecek.');
		} else {
			log('🛡️ [BROKER] Live Trading KAPALI (Dry-run mode). Borsaya gerçek emir gönderilmeyecek.');
		}
	}

	public getRiskManager(): RiskManager {
		return this.riskManager;
	}

	public isLive(): boolean {
		return this.liveEnabled;
	}

	/** Coin kodunu (örn. BTCUSDT) CCXT swap sembolüne dönüştürür (BTC/USDT:USDT) */
	public toSymbol(coin: string): string {
		if (coin.includes('/') || coin.includes(':')) return coin;
		if (coin.endsWith('USDT')) {
			const base = coin.slice(0, -4);
			return `${base}/USDT:USDT`;
		}
		return `${coin}/USDT:USDT`;
	}

	/** CCXT sembolünü standart coine dönüştürür (örn. BTC/USDT:USDT -> BTCUSDT) */
	public toCoin(symbol: string): string {
		return symbol.replace('/USDT:USDT', 'USDT').replace('/USDT', 'USDT');
	}

	/**
	 * İzole marjin ve kaldıraç (1x) yapılandırmasını garantiye alır.
	 * Bir kere ayarlandıktan sonra sembol hafızaya alınır, tekrar çağrılmaz.
	 */
	public async ensureMarketConfig(symbol: string): Promise<void> {
		if (!this.liveEnabled) return;
		if (this.configuredSymbols.has(symbol)) return;

		try {
			await this.exchange.loadMarkets();

			// 1. Margin Mode (ISOLATED)
			try {
				await this.exchange.setMarginMode(config.risk.marginMode, symbol);
				log(`[BROKER] 🛡️ ${symbol} marjin modu ${config.risk.marginMode} olarak ayarlandı.`);
			} catch (err: any) {
				const msg = String(err?.message || err);
				// Binance -4046: "No need to change margin type."
				if (!msg.includes('No need to change margin type') && !msg.includes('-4046')) {
					logError(`[BROKER] ${symbol} marjin modu ayarlanamadı: ${msg}`);
				}
			}

			// 2. Leverage (Varsayılan 1x)
			try {
				await this.exchange.setLeverage(config.risk.leverage, symbol);
				log(`[BROKER] 🛡️ ${symbol} kaldıraç ${config.risk.leverage}x olarak ayarlandı.`);
			} catch (err: any) {
				const msg = String(err?.message || err);
				logError(`[BROKER] ${symbol} kaldıraç ayarlanamadı: ${msg}`);
			}

			this.configuredSymbols.add(symbol);
		} catch (err: any) {
			logError(`[BROKER] ${symbol} piyasa konfigürasyonu hatası: ${err?.message || err}`);
		}
	}

	/**
	 * Canlı veya kuru sıkı (dry-run) giriş emrini yürütür.
	 * Canlı modda:
	 * 1. Serbest teminatı ve risk kurallarını kontrol eder.
	 * 2. İzole marjin & 1x kaldıraç ayarlar.
	 * 3. Market emri ile pozisyon açar.
	 * 4. Hemen ardından borsa tarafında bekleyecek STOP_MARKET ve TAKE_PROFIT_MARKET emirlerini yerleştirir.
	 */
	public async executeEntry(
		coin: string,
		side: 'long' | 'short',
		currentPrice: number,
		stopPrice?: number,
		targetPrice?: number,
	): Promise<LiveOrderResult> {
		const symbol = this.toSymbol(coin);
		const amountUsd = config.risk.maxTradeSizeUsd;

		// 1. Dry Run Modu
		if (!this.liveEnabled) {
			if (!this.riskManager.validateTrade({ coin, side, amountUsd })) {
				return { success: false, error: 'Risk manager validation failed' };
			}

			const stopStr = stopPrice ? `$${stopPrice.toFixed(4)}` : 'Yok';
			const targetStr = targetPrice ? `$${targetPrice.toFixed(4)}` : 'Yok';
			log(
				`[DRY-RUN] ENTRY: ${side.toUpperCase()} ${symbol} @ $${currentPrice.toFixed(4)} | ` +
				`Tutar: $${amountUsd} | Stop: ${stopStr} | Hedef: ${targetStr}`,
			);
			this.riskManager.onTradeOpened();
			return {
				success: true,
				filledPrice: currentPrice,
				filledAmount: amountUsd / currentPrice,
			};
		}

		// 2. Canlı Mod Yürütme
		try {
			await this.exchange.loadMarkets();

			// Serbest teminat sorgusu
			let freeMarginUsd: number | undefined;
			try {
				const balance: any = await this.exchange.fetchBalance();
				freeMarginUsd = Number(balance?.free?.['USDT'] ?? balance?.['USDT']?.free ?? 0);
			} catch (balErr: any) {
				logError(`[BROKER] Bakiye sorgulanamadı: ${balErr?.message || balErr}`);
				return { success: false, error: 'Balance query failed' };
			}

			// Risk Kontrolü
			if (!this.riskManager.validateTrade({ coin, side, amountUsd }, freeMarginUsd)) {
				return { success: false, error: 'Risk check failed' };
			}

			// Marjin ve Kaldıraç Kilidi
			await this.ensureMarketConfig(symbol);

			// Notional ve Hassasiyet Kontrolleri
			const market = this.exchange.market(symbol);
			const minCost = market?.limits?.cost?.min || 5;
			if (amountUsd < minCost) {
				const msg = `İşlem tutarı ($${amountUsd}) Binance minimumu ($${minCost}) altında!`;
				logError(`[BROKER] ❌ ${msg}`);
				return { success: false, error: msg };
			}

			const rawAmount = amountUsd / currentPrice;
			const preciseAmountStr = this.exchange.amountToPrecision(symbol, rawAmount);
			const preciseAmount = Number(preciseAmountStr);

			if (preciseAmount <= 0) {
				logError(`[BROKER] ❌ Geçersiz miktar hesaplandı: ${preciseAmountStr}`);
				return { success: false, error: 'Invalid amount precision' };
			}

			const ccxtOrderSide = side === 'long' ? 'buy' : 'sell';
			const ccxtExitSide = side === 'long' ? 'sell' : 'buy';

			log(`[BROKER] 🚀 LIVE ENTRY gönderiliyor: ${side.toUpperCase()} ${preciseAmount} ${symbol} (~$${amountUsd})`);
			const entryOrder = await this.exchange.createMarketOrder(symbol, ccxtOrderSide, preciseAmount);

			const filledPrice = Number(entryOrder.average || entryOrder.price || currentPrice);
			const filledAmount = Number(entryOrder.filled || preciseAmount);

			log(`[BROKER] ✅ LIVE ENTRY DOLDU: ${symbol} @ $${filledPrice} (Miktar: ${filledAmount})`);

			// Borsa Tarafında STOP_MARKET Emri (reduceOnly)
			let stopOrderId: string | undefined;
			if (stopPrice) {
				try {
					const preciseStop = Number(this.exchange.priceToPrecision(symbol, stopPrice));
					const stopOrder = await this.exchange.createOrder(
						symbol,
						'STOP_MARKET',
						ccxtExitSide,
						filledAmount,
						undefined,
						{
							stopPrice: preciseStop,
							reduceOnly: true,
						},
					);
					stopOrderId = stopOrder.id;
					log(`[BROKER] 🛡️ STOP_MARKET yerleştirildi: ${symbol} @ $${preciseStop} (ID: ${stopOrderId})`);
				} catch (stopErr: any) {
					logError(`[BROKER] ⚠️ STOP_MARKET yerleştirilemedi: ${stopErr?.message || stopErr}`);
				}
			}

			// Borsa Tarafında TAKE_PROFIT_MARKET Emri (reduceOnly)
			let takeProfitOrderId: string | undefined;
			if (targetPrice) {
				try {
					const preciseTarget = Number(this.exchange.priceToPrecision(symbol, targetPrice));
					const tpOrder = await this.exchange.createOrder(
						symbol,
						'TAKE_PROFIT_MARKET',
						ccxtExitSide,
						filledAmount,
						undefined,
						{
							stopPrice: preciseTarget,
							reduceOnly: true,
						},
					);
					takeProfitOrderId = tpOrder.id;
					log(`[BROKER] 🎯 TAKE_PROFIT_MARKET yerleştirildi: ${symbol} @ $${preciseTarget} (ID: ${takeProfitOrderId})`);
				} catch (tpErr: any) {
					logError(`[BROKER] ⚠️ TAKE_PROFIT_MARKET yerleştirilemedi: ${tpErr?.message || tpErr}`);
				}
			}

			this.riskManager.onTradeOpened();

			return {
				success: true,
				orderId: entryOrder.id,
				stopOrderId,
				takeProfitOrderId,
				filledPrice,
				filledAmount,
			};
		} catch (error: any) {
			logError(`[BROKER] Live Entry yürütme hatası (${symbol}): ${error?.message || error}`);
			return { success: false, error: String(error?.message || error) };
		}
	}

	/**
	 * Çıkış emrini yürütür.
	 * Canlı modda:
	 * 1. Bekleyen koşullu STOP ve TP emirlerini iptal eder.
	 * 2. Açık kontrat varsa market emriyle (reduceOnly) kapatır.
	 */
	public async executeExit(
		coin: string,
		side: 'long' | 'short',
		exitPrice: number,
		estimatedPnlUsd: number,
		stopOrderId?: string,
		takeProfitOrderId?: string,
	): Promise<boolean> {
		const symbol = this.toSymbol(coin);

		// 1. Dry Run Modu
		if (!this.liveEnabled) {
			log(`[DRY-RUN] EXIT: ${side.toUpperCase()} ${symbol} @ $${exitPrice.toFixed(4)} | PnL: $${estimatedPnlUsd.toFixed(2)}`);
			this.riskManager.onTradeClosed(estimatedPnlUsd);
			return true;
		}

		// 2. Canlı Mod Yürütme
		try {
			// Açık bracket emirlerini temizle
			if (stopOrderId) {
				try {
					await this.exchange.cancelOrder(stopOrderId, symbol);
					log(`[BROKER] 🧹 Stop emri iptal edildi: ${stopOrderId}`);
				} catch (e) {
					// Emir zaten tetiklenmiş veya iptal edilmiş olabilir
				}
			}

			if (takeProfitOrderId) {
				try {
					await this.exchange.cancelOrder(takeProfitOrderId, symbol);
					log(`[BROKER] 🧹 TP emri iptal edildi: ${takeProfitOrderId}`);
				} catch (e) {
					// Emir zaten tetiklenmiş veya iptal edilmiş olabilir
				}
			}

			// Güvenlik amacıyla semboldeki tüm kalan açık emirleri temizle
			try {
				await this.exchange.cancelAllOrders(symbol);
			} catch (e) {
				// Bazı durumlarda açık emir yoksa hata verebilir, yut
			}

			// Pozisyon büyüklüğünü kontrol et
			let contracts = 0;
			try {
				const positions = await this.exchange.fetchPositions([symbol]);
				const currentPos = positions.find(
					p => (p.symbol === symbol || p.id === coin) && Math.abs(Number(p.contracts || 0)) > 0,
				);
				if (currentPos) {
					contracts = Math.abs(Number(currentPos.contracts));
				}
			} catch (posErr) {
				logError(`[BROKER] Pozisyon sorgusu hatası (${symbol}): ${posErr}`);
			}

			if (contracts > 0) {
				const ccxtExitSide = side === 'long' ? 'sell' : 'buy';
				log(`[BROKER] 🚪 LIVE EXIT piyasa emri gönderiliyor: ${ccxtExitSide.toUpperCase()} ${contracts} ${symbol} (reduceOnly)`);
				await this.exchange.createMarketOrder(symbol, ccxtExitSide, contracts, undefined, { reduceOnly: true });
				log(`[BROKER] ✅ LIVE EXIT kapatıldı: ${symbol}`);
			} else {
				log(`[BROKER] ℹ️ ${symbol} pozisyonu borsada zaten kapalı (Stop veya TP tetiklenmiş).`);
			}

			this.riskManager.onTradeClosed(estimatedPnlUsd);
			return true;
		} catch (error: any) {
			logError(`[BROKER] Live Exit yürütme hatası (${symbol}): ${error?.message || error}`);
			this.riskManager.onTradeClosed(estimatedPnlUsd);
			return false;
		}
	}

	/** Borsa tarafındaki tüm açık pozisyonları listeler */
	public async fetchOpenPositions(): Promise<any[]> {
		if (!this.liveEnabled) return [];
		try {
			const positions = await this.exchange.fetchPositions();
			return positions.filter(p => Math.abs(Number(p.contracts || 0)) > 0);
		} catch (err: any) {
			logError(`[BROKER] Açık pozisyonlar getirilemedi: ${err?.message || err}`);
			return [];
		}
	}

	/** Borsa tarafındaki bekleyen açık emirleri listeler */
	public async fetchOpenOrders(symbol?: string): Promise<any[]> {
		if (!this.liveEnabled) return [];
		try {
			const sym = symbol ? this.toSymbol(symbol) : undefined;
			return await this.exchange.fetchOpenOrders(sym);
		} catch (err: any) {
			logError(`[BROKER] Açık emirler getirilemedi: ${err?.message || err}`);
			return [];
		}
	}

	/** Belirli bir açık emri iptal eder */
	public async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
		if (!this.liveEnabled) return true;
		try {
			const sym = this.toSymbol(symbol);
			await this.exchange.cancelOrder(orderId, sym);
			return true;
		} catch (err: any) {
			logError(`[BROKER] Emir iptal edilemedi (${orderId}): ${err?.message || err}`);
			return false;
		}
	}

	/** Bir sembole ait tüm açık emirleri iptal eder */
	public async cancelAllOrders(symbol: string): Promise<boolean> {
		if (!this.liveEnabled) return true;
		try {
			const sym = this.toSymbol(symbol);
			await this.exchange.cancelAllOrders(sym);
			return true;
		} catch (err: any) {
			logError(`[BROKER] Tüm emirler iptal edilemedi (${symbol}): ${err?.message || err}`);
			return false;
		}
	}
}
