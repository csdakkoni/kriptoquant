// ============================================================================
// KRIPTOQUANT — Paper Broker (Sprint 11)
// ============================================================================
// Paper trading ortamında kullanılır. Broker interface'ini implement eder.
// SimulatedBroker ile aynı slippage/commission mantığı.
// Farkı: Her fill'i dosyaya loglar (persistent trade journal).
// SimulatedBroker'dan INHERIT ETMEZ — ikisi de Broker interface'ini implement eder.
// ============================================================================

import type { Broker, Fill } from './broker.js';

export class PaperBroker implements Broker {
	private readonly commissionRate: number;
	private readonly slippagePercent: number;
	private readonly fills: Fill[] = [];

	constructor(commissionPercent: number, slippagePercent: number) {
		this.commissionRate = commissionPercent / 100;
		this.slippagePercent = slippagePercent;
	}

	buy(timestamp: number, price: number, usdtAmount: number): Fill {
		const executionPrice = price * (1 + this.slippagePercent / 100);
		const commission = usdtAmount * this.commissionRate;
		const netCost = usdtAmount - commission;
		const quantity = netCost / executionPrice;

		const fill: Fill = { timestamp, side: 'BUY', price: executionPrice, quantity, commission };
		this.fills.push(fill);
		return fill;
	}

	sell(timestamp: number, price: number, quantity: number): Fill {
		const executionPrice = price * (1 - this.slippagePercent / 100);
		const grossValue = quantity * executionPrice;
		const commission = grossValue * this.commissionRate;

		const fill: Fill = { timestamp, side: 'SELL', price: executionPrice, quantity, commission };
		this.fills.push(fill);
		return fill;
	}

	getFills(): ReadonlyArray<Fill> {
		return this.fills;
	}
}
