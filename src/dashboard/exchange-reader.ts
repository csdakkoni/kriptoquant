// ============================================================================
// KRIPTOQUANT — Exchange Reader (Read-Only Binance Connection)
// ============================================================================
// Dashboard'un Binance verilerini doğrudan okuması için salt-okunur bağlantı.
// Emir göndermez, yalnızca bakiye/pozisyon/emir durumu sorgular.
// ============================================================================

import ccxt, { Exchange } from 'ccxt';
import { log, logError } from '../core/utils.js';
import { config } from '../core/config.js';

interface CachedData<T> {
	data: T;
	fetchedAt: number;
}

const CACHE_TTL = 30_000; // 30 saniye

export class ExchangeReader {
	private exchange: Exchange | null = null;
	private enabled = false;

	private balanceCache: CachedData<any> | null = null;
	private positionsCache: CachedData<any[]> | null = null;
	private ordersCache: CachedData<any[]> | null = null;

	constructor() {
		this.enabled = !!config.binance.apiKey && !!config.binance.secret && config.isLiveTradingEnabled;

		if (this.enabled) {
			this.exchange = new ccxt.binance({
				apiKey: config.binance.apiKey,
				secret: config.binance.secret,
				enableRateLimit: true,
				options: {
					defaultType: 'future',
					disableFuturesSandboxWarning: true,
				},
			});
			if (config.binance.useTestnet) {
				this.exchange.setSandboxMode(true);
			}
			log('[EXCHANGE-READER] ✅ Borsa okuyucu hazır.');
		} else {
			log('[EXCHANGE-READER] ℹ️ Borsa okuyucu devre dışı (API key yok veya Live Trading kapalı).');
		}
	}

	public isActive(): boolean {
		return this.enabled && this.exchange !== null;
	}

	/** Cüzdan bakiyesi: toplam, serbest, kullanılan teminat */
	public async getBalance(): Promise<{
		totalBalance: number;
		freeBalance: number;
		usedBalance: number;
		unrealizedPnl: number;
		isTestnet: boolean;
	} | null> {
		if (!this.exchange) return null;

		if (this.balanceCache && Date.now() - this.balanceCache.fetchedAt < CACHE_TTL) {
			return this.balanceCache.data;
		}

		try {
			await this.exchange.loadMarkets();
			const balance: any = await this.exchange.fetchBalance();
			const usdt = balance?.USDT || balance?.info?.assets?.find((a: any) => a.asset === 'USDT') || {};

			const result = {
				totalBalance: Number(usdt.total ?? balance?.total?.USDT ?? 0),
				freeBalance: Number(usdt.free ?? balance?.free?.USDT ?? 0),
				usedBalance: Number(usdt.used ?? balance?.used?.USDT ?? 0),
				unrealizedPnl: Number(balance?.info?.totalUnrealizedProfit ?? 0),
				isTestnet: config.binance.useTestnet,
			};

			this.balanceCache = { data: result, fetchedAt: Date.now() };
			return result;
		} catch (err: any) {
			logError(`[EXCHANGE-READER] Bakiye sorgulanamadı: ${err?.message || err}`);
			return this.balanceCache?.data ?? null;
		}
	}

	/** Borsadaki tüm açık pozisyonlar (contracts > 0 olanlar) */
	public async getPositions(): Promise<any[]> {
		if (!this.exchange) return [];

		if (this.positionsCache && Date.now() - this.positionsCache.fetchedAt < CACHE_TTL) {
			return this.positionsCache.data;
		}

		try {
			await this.exchange.loadMarkets();
			const positions = await this.exchange.fetchPositions();
			const open = positions
				.filter((p: any) => Math.abs(Number(p.contracts || 0)) > 0)
				.map((p: any) => ({
					symbol: p.symbol,
					coin: (p.symbol || '').replace('/USDT:USDT', 'USDT'),
					side: Number(p.contracts) > 0 ? 'LONG' : 'SHORT',
					contracts: Math.abs(Number(p.contracts)),
					notional: Math.abs(Number(p.notional || 0)),
					entryPrice: Number(p.entryPrice || 0),
					markPrice: Number(p.markPrice || 0),
					liquidationPrice: Number(p.liquidationPrice || 0),
					unrealizedPnl: Number(p.unrealizedPnl || 0),
					percentage: Number(p.percentage || 0),
					leverage: Number(p.leverage || 1),
					marginMode: p.marginMode || 'isolated',
				}));

			this.positionsCache = { data: open, fetchedAt: Date.now() };
			return open;
		} catch (err: any) {
			logError(`[EXCHANGE-READER] Pozisyonlar sorgulanamadı: ${err?.message || err}`);
			return this.positionsCache?.data ?? [];
		}
	}

	/** Borsadaki tüm bekleyen emirler (STOP_MARKET, TAKE_PROFIT_MARKET vb.) */
	public async getOpenOrders(): Promise<any[]> {
		if (!this.exchange) return [];

		if (this.ordersCache && Date.now() - this.ordersCache.fetchedAt < CACHE_TTL) {
			return this.ordersCache.data;
		}

		try {
			await this.exchange.loadMarkets();
			const orders = await this.exchange.fetchOpenOrders();
			const mapped = orders.map((o: any) => ({
				id: o.id,
				symbol: o.symbol,
				coin: (o.symbol || '').replace('/USDT:USDT', 'USDT'),
				type: o.type,
				side: (o.side || '').toUpperCase(),
				amount: Number(o.amount || 0),
				triggerPrice: Number(o.triggerPrice || o.stopPrice || o.info?.stopPrice || 0),
				reduceOnly: o.reduceOnly ?? o.info?.reduceOnly ?? false,
				status: o.status,
				timestamp: o.timestamp,
			}));

			this.ordersCache = { data: mapped, fetchedAt: Date.now() };
			return mapped;
		} catch (err: any) {
			logError(`[EXCHANGE-READER] Emirler sorgulanamadı: ${err?.message || err}`);
			return this.ordersCache?.data ?? [];
		}
	}

	/** Tüm borsa durumunu tek seferde döndür (dashboard için) */
	public async getFullState(): Promise<{
		enabled: boolean;
		isTestnet: boolean;
		balance: any;
		positions: any[];
		orders: any[];
	}> {
		if (!this.enabled) {
			return {
				enabled: false,
				isTestnet: config.binance.useTestnet,
				balance: null,
				positions: [],
				orders: [],
			};
		}

		const [balance, positions, orders] = await Promise.all([
			this.getBalance(),
			this.getPositions(),
			this.getOpenOrders(),
		]);

		return {
			enabled: true,
			isTestnet: config.binance.useTestnet,
			balance,
			positions,
			orders,
		};
	}
}
