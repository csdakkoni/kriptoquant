// ============================================================================
// KRIPTOQUANT — Position Book (Sprint 18)
// ============================================================================
// Çoklu pozisyonları takip eden birleşik hesap defteri.
// ============================================================================

import type { Trade, Fill, Candle } from '../../core/types.js';
import { round } from '../../core/utils.js';

interface ActivePosition {
	readonly coin: string;
	readonly entryPrice: number;
	readonly quantity: number;
	readonly entryValue: number;
	readonly entryCommission: number;
	readonly entryOrder: any;
	readonly atrAtEntry: number;
	readonly stopLossPrice: number;
	highestPrice: number;
	lowestPrice: number;
}

export class PositionBook {
	private readonly positions = new Map<string, ActivePosition>();
	private readonly trades: Trade[] = [];
	private realizedPnl = 0;

	open(coin: string, fill: Fill, atr: number, stopLoss: number): void {
		this.positions.set(coin, {
			coin,
			entryPrice: fill.price,
			quantity: fill.quantity,
			entryValue: fill.quantity * fill.price,
			entryCommission: fill.commission,
			entryOrder: fill.order,
			atrAtEntry: atr,
			stopLossPrice: stopLoss,
			highestPrice: fill.price,
			lowestPrice: fill.price,
		});
	}

	close(coin: string, fill: Fill, reason: string): Trade {
		const pos = this.positions.get(coin);
		if (!pos) {
			throw new Error(`No open position to close for ${coin}`);
		}
		this.positions.delete(coin);

		const netValue = fill.quantity * fill.price - fill.commission;
		const grossPnl = pos.quantity * (fill.price - pos.entryPrice);
		const totalCommission = pos.entryCommission + fill.commission;
		const netPnl = netValue - pos.entryValue;
		const pnlPercent = (netPnl / pos.entryValue) * 100;

		// MAE / MFE Fiyat Güncellemeleri
		if (fill.price > pos.highestPrice) pos.highestPrice = fill.price;
		if (fill.price < pos.lowestPrice) pos.lowestPrice = fill.price;

		const mae = ((pos.lowestPrice - pos.entryPrice) / pos.entryPrice) * 100;
		const mfe = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100;

		const trade: Trade = {
			asset: coin,
			entryOrder: pos.entryOrder,
			exitOrder: fill.order,
			positionSize: pos.entryValue,
			commission: round(totalCommission, 4),
			grossPnl: round(grossPnl, 4),
			pnl: round(netPnl, 4),
			pnlPercent: round(pnlPercent, 2),
			holdingPeriod: fill.timestamp - pos.entryOrder.timestamp,
			atrAtEntry: pos.atrAtEntry,
			exitReason: reason,
			highestPrice: pos.highestPrice,
			lowestPrice: pos.lowestPrice,
			mae: round(mae, 2),
			mfe: round(mfe, 2),
		};

		this.trades.push(trade);
		this.realizedPnl += netPnl;
		return trade;
	}

	hasOpen(coin: string): boolean {
		return this.positions.has(coin);
	}

	getQuantity(coin: string): number {
		return this.positions.get(coin)?.quantity ?? 0;
	}

	getOpenCount(): number {
		return this.positions.size;
	}

	getTrades(): Trade[] {
		return this.trades;
	}

	getRealizedPnl(): number {
		return this.realizedPnl;
	}

	/**
	 * Mum barı içi fiyatları günceller (MAE/MFE takibi için).
	 */
	updateIntraTradePrices(coin: string, high: number, low: number): void {
		const pos = this.positions.get(coin);
		if (pos) {
			if (high > pos.highestPrice) pos.highestPrice = high;
			if (low < pos.lowestPrice) pos.lowestPrice = low;
		}
	}

	/**
	 * Mum barı fiyatına göre stop-loss tetiklenmelerini kontrol eder.
	 */
	evaluateStops(candleMap: Map<string, Candle>): { coin: string; price: number; reason: string }[] {
		const triggered: { coin: string; price: number; reason: string }[] = [];

		for (const [coin, pos] of this.positions.entries()) {
			const candle = candleMap.get(coin);
			if (!candle) continue;

			// Fiyat takibini güncelle
			this.updateIntraTradePrices(coin, candle.high, candle.low);

			// Stop-loss kontrolü
			if (candle.low <= pos.stopLossPrice) {
				const exitPrice = Math.min(candle.open, pos.stopLossPrice); // Gap down koruması
				triggered.push({
					coin,
					price: exitPrice,
					reason: 'Stop-Loss (ATR)',
				});
			}
		}

		return triggered;
	}

	/**
	 * Açık pozisyonların anlık piyasa değerini hesaplar.
	 */
	getMarkToMarketValue(candleMap: Map<string, Candle>): number {
		let totalValue = 0;
		for (const [coin, pos] of this.positions.entries()) {
			const candle = candleMap.get(coin);
			const price = candle ? candle.close : pos.entryPrice;
			totalValue += pos.quantity * price;
		}
		return totalValue;
	}
}
