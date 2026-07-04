// ============================================================================
// KRIPTOQUANT — Simulated Broker (Sprint 11)
// ============================================================================
// Backtest ortamında kullanılır. Broker interface'ini implement eder.
// Tek görevi: slippage + commission uygulamak.
// Deterministik. Side effect yok. ATR/stop-loss bilmez.
// ============================================================================

import type { Broker, Fill } from './broker.js';

export class SimulatedBroker implements Broker {
	private readonly commissionRate: number;
	private readonly slippagePercent: number;

	constructor(commissionPercent: number, slippagePercent: number) {
		this.commissionRate = commissionPercent / 100;
		this.slippagePercent = slippagePercent;
	}

	buy(timestamp: number, price: number, usdtAmount: number): Fill {
		const executionPrice = price * (1 + this.slippagePercent / 100);
		const commission = usdtAmount * this.commissionRate;
		const netCost = usdtAmount - commission;
		const quantity = netCost / executionPrice;

		return {
			timestamp,
			side: 'BUY',
			price: executionPrice,
			quantity,
			commission,
		};
	}

	sell(timestamp: number, price: number, quantity: number): Fill {
		const executionPrice = price * (1 - this.slippagePercent / 100);
		const grossValue = quantity * executionPrice;
		const commission = grossValue * this.commissionRate;

		return {
			timestamp,
			side: 'SELL',
			price: executionPrice,
			quantity,
			commission,
		};
	}
}
