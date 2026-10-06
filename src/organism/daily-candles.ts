// ============================================================================
// ORGANISM — Günlük Mumlar (yavaş zaman dilimi)
// ============================================================================
// 15 dakikalık tampon yalnızca ~5 günü tutar. Günlük trend deneyleri ise
// haftalara bakar, bu yüzden günlük mumlar ayrıca çekilir. Günlük ölçekte
// hareketler büyük olduğu için %0.20 işlem maliyeti önemsizleşir.
//
// Veri Binance'in herkese açık futures uç noktasından gelir (API anahtarı
// gerekmez) ve saatte bir tazelenir. Yalnızca KAPANMIŞ günler saklanır.
// ============================================================================

import { logError } from '../core/utils.js';

const FUTURES_REST = process.env.FUTURES_REST_URL || 'https://fapi.binance.com';
const REFRESH_MS = 60 * 60 * 1000;

export interface DailyCandle {
	openTime: number;
	high: number;
	close: number;
}

export class DailyCandleTracker {
	private days = new Map<string, DailyCandle[]>();
	private lastRefresh = 0;

	/** Kapanmış günlük mumları elle yükler (testler için) */
	set(coin: string, candles: DailyCandle[]): void {
		this.days.set(coin, candles);
	}

	/** Son `lookback` KAPANMIŞ günün en yüksek fiyatı; veri yetmezse undefined */
	highestHigh(coin: string, lookback: number): number | undefined {
		const list = this.days.get(coin);
		if (!list || list.length < lookback) return undefined;
		return Math.max(...list.slice(-lookback).map((d) => d.high));
	}

	/** Günlük mumları borsadan çeker (saatte bir; daha sık çağrılırsa atlar) */
	async refresh(coins: string[], force = false): Promise<void> {
		if (!force && Date.now() - this.lastRefresh < REFRESH_MS) return;
		this.lastRefresh = Date.now();
		for (const coin of coins) {
			try {
				const res = await fetch(`${FUTURES_REST}/fapi/v1/klines?symbol=${coin}&interval=1d&limit=61`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as [number, string, string, string, string][];
				// Son eleman bugünün hâlâ AÇIK mumudur — atılır
				this.days.set(
					coin,
					data.slice(0, -1).map((d) => ({ openTime: Number(d[0]), high: Number.parseFloat(d[2]), close: Number.parseFloat(d[4]) })),
				);
				await new Promise((r) => setTimeout(r, 100)); // rate limit nezaketi
			} catch (err) {
				logError(`[GÜNLÜK] ${coin} günlük mumları alınamadı: ${err}`);
			}
		}
	}
}

/** Uygulama genelinde paylaşılan tek örnek */
export const dailyCandles = new DailyCandleTracker();
