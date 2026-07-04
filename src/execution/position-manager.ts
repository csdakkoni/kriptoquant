// ============================================================================
// KRIPTOQUANT — Position Manager (Sprint 12)
// ============================================================================
// Pozisyon bazlı işlemleri yönetir: giriş/çıkış, ATR stop-loss değerlendirme,
// mark-to-market güncelleme.
// ============================================================================

import type { Order, Trade } from '../core/types.js';
import type { Fill } from './broker.js';
import type { PositionInfo, StopRule, StopSignal } from './stop-rule.js';
import { round } from '../core/utils.js';

export class PositionManager {
	private quantity: number = 0;
	private entryPrice: number = 0;
	private stopLossPrice: number = 0;
	private atrAtEntry: number = 0;
	private entryTimestamp: number = 0;
	private entryCommission: number = 0;
	private entryValue: number = 0;
	private entryOrder: Order | null = null;
	private highestPrice: number = 0;
	private lowestPrice: number = 0;

	open(fill: Fill, orderValue: number, atrAtEntry: number, stopLossPrice: number): void {
		this.quantity = fill.quantity;
		this.entryPrice = fill.price;
		this.stopLossPrice = stopLossPrice;
		this.atrAtEntry = atrAtEntry;
		this.entryTimestamp = fill.timestamp;
		this.entryCommission = fill.commission;
		this.entryValue = orderValue;
		this.entryOrder = {
			timestamp: fill.timestamp,
			side: 'BUY',
			price: fill.price,
			quantity: fill.quantity,
			value: orderValue,
		};
		this.highestPrice = fill.price;
		this.lowestPrice = fill.price;
	}

	close(fill: Fill, exitReason: string, coin: string): Trade {
		if (!this.hasOpen()) {
			throw new Error('Kapatılacak açık pozisyon bulunamadı.');
		}

		if (!this.entryOrder) {
			throw new Error('Giriş emri bilgisi eksik.');
		}

		const grossValue = fill.quantity * fill.price;
		const netValue = grossValue - fill.commission;

		const exitOrder: Order = {
			timestamp: fill.timestamp,
			side: 'SELL',
			price: fill.price,
			quantity: fill.quantity,
			value: netValue,
		};

		const grossPnl = this.quantity * (fill.price - this.entryPrice);
		const totalCommission = this.entryCommission + fill.commission;
		const netPnl = netValue - this.entryValue;
		const pnlPercent = (netPnl / this.entryValue) * 100;

		if (fill.price > this.highestPrice) this.highestPrice = fill.price;
		if (fill.price < this.lowestPrice) this.lowestPrice = fill.price;

		const mae = ((this.lowestPrice - this.entryPrice) / this.entryPrice) * 100;
		const mfe = ((this.highestPrice - this.entryPrice) / this.entryPrice) * 100;

		const trade: Trade = {
			asset: coin,
			entryOrder: this.entryOrder,
			exitOrder,
			positionSize: this.entryValue,
			commission: round(totalCommission, 4),
			grossPnl: round(grossPnl, 4),
			pnl: round(netPnl, 4),
			pnlPercent: round(pnlPercent, 4),
			holdingPeriod: fill.timestamp - this.entryTimestamp,
			atrAtEntry: round(this.atrAtEntry, 4),
			exitReason,
			highestPrice: round(this.highestPrice, 4),
			lowestPrice: round(this.lowestPrice, 4),
			mae: round(mae, 4),
			mfe: round(mfe, 4),
		};

		// Pozisyonu sıfırla
		this.reset();

		return trade;
	}

	hasOpen(): boolean {
		return this.quantity > 0;
	}

	getQuantity(): number {
		return this.quantity;
	}

	getStopLossPrice(): number {
		return this.stopLossPrice;
	}

	getPositionInfo(): PositionInfo | null {
		if (!this.hasOpen()) return null;
		return {
			entryPrice: this.entryPrice,
			quantity: this.quantity,
			stopLossPrice: this.stopLossPrice,
			atrAtEntry: this.atrAtEntry,
			entryTimestamp: this.entryTimestamp,
		};
	}

	evaluateStopLoss(candle: Candle, stopRule: StopRule): StopSignal | null {
		const info = this.getPositionInfo();
		if (!info) return null;
		return stopRule.evaluate(info, candle);
	}

	updateMarkToMarket(price: number): number {
		return this.quantity * price;
	}

	updateIntraTradePrices(high: number, low: number): void {
		if (!this.hasOpen()) return;
		if (high > this.highestPrice) this.highestPrice = high;
		if (low < this.lowestPrice) this.lowestPrice = low;
	}

	private reset(): void {
		this.quantity = 0;
		this.entryPrice = 0;
		this.stopLossPrice = 0;
		this.atrAtEntry = 0;
		this.entryTimestamp = 0;
		this.entryCommission = 0;
		this.entryValue = 0;
		this.entryOrder = null;
		this.highestPrice = 0;
		this.lowestPrice = 0;
	}
}
import type { Candle } from '../core/types.js';
