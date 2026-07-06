// ============================================================================
// KRIPTOQUANT — Paribu Market Data Client (Sprint 29)
// ============================================================================

import { log, logError } from '../core/utils.js';

export interface ParibuTickerItem {
	last: number;
	lowestAsk: number;
	highestBid: number;
	low24hr: number;
	high24hr: number;
	volume: number;
	percentChange: number;
}

export class ParibuClient {
	private baseUrl = 'https://www.paribu.com';

	/**
	 * Fetch ticker object from Paribu API.
	 */
	public async fetchTicker(): Promise<Record<string, ParibuTickerItem>> {
		try {
			const res = await fetch(`${this.baseUrl}/ticker`, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
					'Accept': 'application/json'
				}
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const data = await res.json();
			return data as Record<string, ParibuTickerItem>;
		} catch (e) {
			logError(`Failed to fetch Paribu ticker: ${e instanceof Error ? e.message : String(e)}`);
			throw e;
		}
	}

	/**
	 * Get current USDT/TRY conversion rate.
	 */
	public async getUsdTryRate(): Promise<number> {
		try {
			const ticker = await this.fetchTicker();
			if (ticker && ticker['USDT_TL']) {
				return ticker['USDT_TL'].last;
			}
			return 32.0; // Fallback
		} catch {
			return 32.0; // Fallback on failure
		}
	}

	/**
	 * Get last traded price in USDT for a given coin.
	 * If the coin trades in USDT on Paribu (e.g. BTC_USDT), returns it directly.
	 * If it trades in TL (e.g. BTC_TL), converts it to USDT using current USDT_TL rate.
	 */
	public async getCoinPriceInUsdt(coin: string): Promise<number> {
		try {
			// Strip 'USDT' to get raw symbol, e.g. 'BTCUSDT' -> 'BTC'
			const symbol = coin.endsWith('USDT') ? coin.slice(0, -4) : coin;
			const ticker = await this.fetchTicker();

			// 1) Try USDT pair first, e.g. BTC_USDT
			const usdtKey = `${symbol}_USDT`;
			if (ticker[usdtKey]) {
				return ticker[usdtKey].last;
			}

			// 2) Try TL pair, convert to USDT, e.g. BTC_TL / USDT_TL
			const tlKey = `${symbol}_TL`;
			const usdtTl = ticker['USDT_TL'] ? ticker['USDT_TL'].last : 32.0;

			if (ticker[tlKey]) {
				return ticker[tlKey].last / usdtTl;
			}

			throw new Error(`Symbol ${coin} (key: ${usdtKey} or ${tlKey}) not found on Paribu`);
		} catch (e) {
			logError(`Failed to get coin price in USDT for ${coin}: ${e}`);
			return 0; // Default fallback
		}
	}
}
