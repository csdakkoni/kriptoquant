// ============================================================================
// KRIPTOQUANT — Paper Broker (Sprint 11)
// ============================================================================
// Paper trading ortamında kullanılır. Broker interface'ini implement eder.
// SimulatedBroker ile aynı slippage/commission mantığı.
// Farkı: Her fill'i dosyaya loglar (persistent trade journal).
// SimulatedBroker'dan INHERIT ETMEZ — ikisi de Broker interface'ini implement eder.
// ============================================================================

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Broker, Fill } from './broker.js';

export class PaperBroker implements Broker {
	private readonly commissionRate: number;
	private readonly slippagePercent: number;
	private readonly logPath: string;
	private readonly fills: Fill[] = [];
	private initialized = false;

	constructor(commissionPercent: number, slippagePercent: number, logPath: string = 'results/paper-trades.csv') {
		this.commissionRate = commissionPercent / 100;
		this.slippagePercent = slippagePercent;
		this.logPath = logPath;
	}

	buy(timestamp: number, price: number, usdtAmount: number): Fill {
		const executionPrice = price * (1 + this.slippagePercent / 100);
		const commission = usdtAmount * this.commissionRate;
		const netCost = usdtAmount - commission;
		const quantity = netCost / executionPrice;

		const fill: Fill = { timestamp, side: 'BUY', price: executionPrice, quantity, commission };
		this.logFill(fill);
		return fill;
	}

	sell(timestamp: number, price: number, quantity: number): Fill {
		const executionPrice = price * (1 - this.slippagePercent / 100);
		const grossValue = quantity * executionPrice;
		const commission = grossValue * this.commissionRate;

		const fill: Fill = { timestamp, side: 'SELL', price: executionPrice, quantity, commission };
		this.logFill(fill);
		return fill;
	}

	getFills(): ReadonlyArray<Fill> {
		return this.fills;
	}

	private logFill(fill: Fill): void {
		this.fills.push(fill);

		const dir = dirname(this.logPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		if (!this.initialized) {
			writeFileSync(this.logPath, 'Timestamp,Side,Price,Quantity,Commission\n', 'utf-8');
			this.initialized = true;
		}

		const row = `${new Date(fill.timestamp).toISOString()},${fill.side},${fill.price},${fill.quantity},${fill.commission}\n`;
		appendFileSync(this.logPath, row, 'utf-8');
	}
}
