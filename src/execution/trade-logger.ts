// ============================================================================
// KRIPTOQUANT — Trade Logger (Sprint 12)
// ============================================================================
// Kayıt ve persistence katmanı. Broker'dan tamamen ayrıştırılmıştır.
// ============================================================================

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Trade } from '../core/types.js';
import type { Fill } from './broker.js';

export interface TradeLogger {
	onFill(fill: Fill): void;
	onTrade(trade: Trade): void;
	flush(): void;
	close(): void;
}

// ─── CSV Trade Logger ────────────────────────────────────────────────────────

export class CSVTradeLogger implements TradeLogger {
	private readonly logPath: string;
	private initialized = false;
	private buffer: string[] = [];

	constructor(logPath: string) {
		this.logPath = logPath;
	}

	onFill(fill: Fill): void {
		const dir = dirname(this.logPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		if (!this.initialized) {
			writeFileSync(this.logPath, 'Timestamp,Side,Price,Quantity,Commission\n', 'utf-8');
			this.initialized = true;
		}

		const row = `${new Date(fill.timestamp).toISOString()},${fill.side},${fill.price},${fill.quantity},${fill.commission}\n`;
		this.buffer.push(row);

		// buffer size control
		if (this.buffer.length >= 5) {
			this.flush();
		}
	}

	onTrade(trade: Trade): void {
		// Bu sınıf şu an sadece fill'leri logluyor, opsiyonel olarak trade'leri de başka yere loglayabiliriz.
	}

	flush(): void {
		if (this.buffer.length === 0) return;
		appendFileSync(this.logPath, this.buffer.join(''), 'utf-8');
		this.buffer = [];
	}

	close(): void {
		this.flush();
	}
}

// ─── Console Trade Logger ────────────────────────────────────────────────────

export class ConsoleTradeLogger implements TradeLogger {
	onFill(fill: Fill): void {
		console.log(`[Fill] ${fill.side} ${fill.quantity} @ ${fill.price} (Comm: ${fill.commission})`);
	}

	onTrade(trade: Trade): void {
		console.log(`[Trade Closed] PnL: ${trade.pnl}% (${trade.pnlPercent}%) | Reason: ${trade.exitReason}`);
	}

	flush(): void {}
	close(): void {}
}
