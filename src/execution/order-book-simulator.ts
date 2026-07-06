// ============================================================================
// KRIPTOQUANT — L2 Order Book & Price-Time Priority Simulator (Sprint 35)
// ============================================================================

export interface LimitOrder {
	orderId: string;
	price: number;
	quantity: number;
	timestamp: number;
	side: 'BUY' | 'SELL';
}

export interface OrderBookLevel {
	price: number;
	quantity: number;
}

export class OrderBookSimulator {
	private bids: LimitOrder[] = [];
	private asks: LimitOrder[] = [];
	private idCounter = 0;

	constructor() {
		// Initialize with some default L2 depth layers
		this.resetToDefaults();
	}

	public resetToDefaults(): void {
		this.bids = [];
		this.asks = [];
		this.idCounter = 0;

		// Initialize default bids (from 99.5 down to 97.5)
		for (let i = 1; i <= 5; i++) {
			this.addLimitOrder('BUY', 100 - (i * 0.5), 10 + i * 5);
		}
		// Initialize default asks (from 100.5 up to 102.5)
		for (let i = 1; i <= 5; i++) {
			this.addLimitOrder('SELL', 100 + (i * 0.5), 10 + i * 5);
		}
	}

	/**
	 * Price-Time Priority kuralına göre limit emrini deftere ekler.
	 */
	public addLimitOrder(side: 'BUY' | 'SELL', price: number, quantity: number): string {
		this.idCounter++;
		const orderId = `OB-${this.idCounter}`;
		
		const newOrder: LimitOrder = {
			orderId,
			price,
			quantity,
			timestamp: Date.now() + this.idCounter, // ensure unique timestamps
			side
		};

		if (side === 'BUY') {
			this.bids.push(newOrder);
			// Price-Time priority: Sort bids by price DESC, then timestamp ASC
			this.bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
		} else {
			this.asks.push(newOrder);
			// Price-Time priority: Sort asks by price ASC, then timestamp ASC
			this.asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
		}

		return orderId;
	}

	/**
	 * Limit emrini defterden siler.
	 */
	public cancelLimitOrder(orderId: string): boolean {
		const originalBidsLength = this.bids.length;
		this.bids = this.bids.filter(o => o.orderId !== orderId);
		if (this.bids.length < originalBidsLength) return true;

		const originalAsksLength = this.asks.length;
		this.asks = this.asks.filter(o => o.orderId !== orderId);
		return this.asks.length < originalAsksLength;
	}

	/**
	 * Market (Taker) emrini defterdeki likiditeyle eşleştirir ve dolum detaylarını döner.
	 * 
	 * @param side - Market emrinin yönü (Taker BUY/SELL)
	 * @param quantity - Eşleşecek miktar
	 */
	public matchAgainstTaker(side: 'BUY' | 'SELL', quantity: number): {
		filledQuantity: number;
		averageFillPrice: number;
		remainingQuantity: number;
	} {
		let remaining = quantity;
		let totalValue = 0;
		let filled = 0;

		// Taker BUY matches against Asks (seller limit orders)
		// Taker SELL matches against Bids (buyer limit orders)
		const targetBook = side === 'BUY' ? this.asks : this.bids;

		while (remaining > 0 && targetBook.length > 0) {
			const bestOrder = targetBook[0];
			const matchQty = Math.min(remaining, bestOrder.quantity);

			totalValue += matchQty * bestOrder.price;
			bestOrder.quantity -= matchQty;
			remaining -= matchQty;
			filled += matchQty;

			// If the limit order is fully consumed, remove it
			if (bestOrder.quantity <= 0) {
				targetBook.shift();
			}
		}

		const averageFillPrice = filled > 0 ? (totalValue / filled) : 0;

		return {
			filledQuantity: parseFloat(filled.toFixed(4)),
			averageFillPrice: parseFloat(averageFillPrice.toFixed(4)),
			remainingQuantity: parseFloat(remaining.toFixed(4))
		};
	}

	/**
	 * Arayüze L2 derinlik profilini döner.
	 */
	public getL2Depth(): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
		const bidsMap = new Map<number, number>();
		const asksMap = new Map<number, number>();

		this.bids.forEach(o => bidsMap.set(o.price, (bidsMap.get(o.price) || 0) + o.quantity));
		this.asks.forEach(o => asksMap.set(o.price, (asksMap.get(o.price) || 0) + o.quantity));

		const formattedBids = Array.from(bidsMap.entries())
			.map(([price, quantity]) => ({ price, quantity }))
			.sort((a, b) => b.price - a.price)
			.slice(0, 5);

		const formattedAsks = Array.from(asksMap.entries())
			.map(([price, quantity]) => ({ price, quantity }))
			.sort((a, b) => a.price - b.price)
			.slice(0, 5);

		return {
			bids: formattedBids,
			asks: formattedAsks
		};
	}
}
