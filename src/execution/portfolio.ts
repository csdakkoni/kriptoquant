// ============================================================================
// KRIPTOQUANT — Portfolio (Sprint 11)
// ============================================================================
// Hesap durumunu yönetir: pozisyon, sermaye, equity curve, trade geçmişi.
// Broker bilmez. Strateji bilmez. Sadece hesabı yönetir.
//
// İleride çoklu varlık (BTC + ETH + SOL) desteği buraya eklenir.
// ============================================================================

import type { Order, Trade, EquityPoint } from '../core/types.js';
import type { Fill } from './broker.js';
import { formatDate, round } from '../core/utils.js';

// ─── Açık Pozisyon ───────────────────────────────────────────────────────────

interface OpenPosition {
	quantity: number;
	entryOrder: Order;
	entryCommission: number;
	atrAtEntry: number;
	stopLossPrice: number;
}

// ─── Portfolio ───────────────────────────────────────────────────────────────

export class Portfolio {
	private capital: number;
	private readonly initialCapital: number;
	private position: OpenPosition | null = null;
	private readonly trades: Trade[] = [];
	private readonly equityCurve: EquityPoint[] = [];
	private peakEquity: number;
	private maxDrawdown: number = 0;
	private dailyPnl: number = 0;
	private currentDay: string = '';
	private rejectedCount: number = 0;

	constructor(initialCapital: number) {
		this.capital = initialCapital;
		this.initialCapital = initialCapital;
		this.peakEquity = initialCapital;
	}

	// ── Pozisyon Yönetimi ────────────────────────────────────────────────

	openPosition(fill: Fill, orderValue: number, atrAtEntry: number, stopLossPrice: number): void {
		this.capital -= orderValue;
		this.position = {
			quantity: fill.quantity,
			entryOrder: {
				timestamp: fill.timestamp,
				side: 'BUY',
				price: fill.price,
				quantity: fill.quantity,
				value: orderValue,
			},
			entryCommission: fill.commission,
			atrAtEntry,
			stopLossPrice,
		};
	}

	closePosition(fill: Fill, exitReason: string, coin: string): Trade {
		if (!this.position) throw new Error('Kapatılacak pozisyon yok');

		const grossValue = fill.quantity * fill.price;
		const netValue = grossValue - fill.commission;

		const exitOrder: Order = {
			timestamp: fill.timestamp,
			side: 'SELL',
			price: fill.price,
			quantity: fill.quantity,
			value: netValue,
		};

		const grossPnl = this.position.quantity * (fill.price - this.position.entryOrder.price);
		const totalCommission = this.position.entryCommission + fill.commission;
		const netPnl = netValue - this.position.entryOrder.value;
		const pnlPercent = (netPnl / this.position.entryOrder.value) * 100;

		const trade: Trade = {
			asset: coin,
			entryOrder: this.position.entryOrder,
			exitOrder,
			positionSize: this.position.entryOrder.value,
			commission: round(totalCommission, 4),
			grossPnl: round(grossPnl, 4),
			pnl: round(netPnl, 4),
			pnlPercent: round(pnlPercent, 4),
			holdingPeriod: fill.timestamp - this.position.entryOrder.timestamp,
			atrAtEntry: round(this.position.atrAtEntry, 4),
			exitReason,
		};

		this.trades.push(trade);
		this.capital += netValue;
		this.dailyPnl += trade.pnl;
		this.position = null;

		this.updateDrawdown();

		return trade;
	}

	hasOpenPosition(): boolean {
		return this.position !== null;
	}

	getPositionQuantity(): number {
		return this.position?.quantity ?? 0;
	}

	getStopLossPrice(): number {
		return this.position?.stopLossPrice ?? 0;
	}

	// ── Sermaye & Günlük Takip ───────────────────────────────────────────

	getCapital(): number {
		return this.capital;
	}

	getDailyPnl(): number {
		return this.dailyPnl;
	}

	/**
	 * Yeni gün kontrolü. Gün değişmişse günlük P&L sıfırlanır.
	 */
	updateDay(timestampMs: number): void {
		const day = formatDate(timestampMs);
		if (day !== this.currentDay) {
			this.currentDay = day;
			this.dailyPnl = 0;
		}
	}

	incrementRejected(): void {
		this.rejectedCount++;
	}

	// ── Equity Curve ─────────────────────────────────────────────────────

	/**
	 * Mark-to-market: Mevcut portföy değerini kaydeder.
	 */
	recordEquityPoint(timestamp: number, currentPrice: number): void {
		const openValue = this.position !== null ? this.position.quantity * currentPrice : 0;
		const equity = round(this.capital + openValue, 2);

		if (equity > this.peakEquity) this.peakEquity = equity;
		const dd = round(((this.peakEquity - equity) / this.peakEquity) * 100, 2);
		if (dd > this.maxDrawdown) this.maxDrawdown = dd;

		const ret = round(((equity - this.initialCapital) / this.initialCapital) * 100, 2);

		this.equityCurve.push({
			timestamp,
			equity,
			drawdownPercent: dd,
			returnPercent: ret,
		});
	}

	// ── Getterlar ────────────────────────────────────────────────────────

	getTrades(): ReadonlyArray<Trade> {
		return this.trades;
	}

	getEquityCurve(): ReadonlyArray<EquityPoint> {
		return this.equityCurve;
	}

	getMaxDrawdown(): number {
		return this.maxDrawdown;
	}

	getRejectedCount(): number {
		return this.rejectedCount;
	}

	getInitialCapital(): number {
		return this.initialCapital;
	}

	getFinalCapital(): number {
		return this.capital;
	}

	// ── İç Yardımcılar ──────────────────────────────────────────────────

	private updateDrawdown(): void {
		if (this.capital > this.peakEquity) this.peakEquity = this.capital;
		const dd = ((this.peakEquity - this.capital) / this.peakEquity) * 100;
		if (dd > this.maxDrawdown) this.maxDrawdown = dd;
	}
}
