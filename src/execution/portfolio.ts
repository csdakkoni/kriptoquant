// ============================================================================
// KRIPTOQUANT — Portfolio (Sprint 12)
// ============================================================================
// Hesap durumunu yönetir: nakit, equity curve, trade geçmişi, günlük P&L.
// Pozisyon yönetimi PositionManager'a taşınmıştır.
// ============================================================================

import type { Trade, EquityPoint } from '../core/types.js';
import { formatDate, round } from '../core/utils.js';
import { PositionManager } from './position-manager.js';

export class Portfolio {
	private capital: number;
	private readonly initialCapital: number;
	readonly positions: PositionManager;
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
		this.positions = new PositionManager();
	}

	deductCapital(amount: number): void {
		this.capital -= amount;
	}

	addCapital(amount: number): void {
		this.capital += amount;
		this.updateDrawdown();
	}

	getCapital(): number {
		return this.capital;
	}

	addTrade(trade: Trade): void {
		this.trades.push(trade);
		this.dailyPnl += trade.pnl;
	}

	getDailyPnl(): number {
		return this.dailyPnl;
	}

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

	recordEquityPoint(timestamp: number, currentPrice: number): void {
		const openValue = this.positions.updateMarkToMarket(currentPrice);
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

	private updateDrawdown(): void {
		if (this.capital > this.peakEquity) this.peakEquity = this.capital;
		const dd = ((this.peakEquity - this.capital) / this.peakEquity) * 100;
		if (dd > this.maxDrawdown) this.maxDrawdown = dd;
	}
}
