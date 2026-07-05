// ============================================================================
// KRIPTOQUANT — Executor Contract & Implementations (Sprint 26)
// ============================================================================

export interface ExecutorFill {
	readonly timestamp: number;
	readonly side: 'BUY' | 'SELL';
	readonly price: number;       // Slippage-adjusted price
	readonly quantity: number;    // Quantity executed
	readonly commission: number;  // Commission in USDT
}

export interface Executor {
	buy(symbol: string, price: number, usdtAmount: number, timestamp: number): ExecutorFill;
	sell(symbol: string, price: number, quantity: number, timestamp: number): ExecutorFill;
}

// ─── PaperExecutor: Simulates execution with commission & slippage ───────────

export class PaperExecutor implements Executor {
	private readonly commissionRate: number;
	private readonly slippageRate: number;

	constructor(commissionRate: number = 0.001, slippageRate: number = 0.0005) {
		this.commissionRate = commissionRate; // Default: 0.1% (Binance VIP 0 level)
		this.slippageRate = slippageRate;     // Default: 0.05%
	}

	buy(symbol: string, price: number, usdtAmount: number, timestamp: number): ExecutorFill {
		const executionPrice = price * (1 + this.slippageRate);
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

	sell(symbol: string, price: number, quantity: number, timestamp: number): ExecutorFill {
		const executionPrice = price * (1 - this.slippageRate);
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

// ─── BinanceExecutor: SKELETON ONLY (Real money disabled) ───────────────────

export class BinanceExecutor implements Executor {
	constructor() {
		// Skeleton constructor - API Keys placeholder
	}

	buy(symbol: string, price: number, usdtAmount: number, timestamp: number): ExecutorFill {
		throw new Error('BinanceExecutor is in skeleton mode. Real-money live trading is disabled.');
	}

	sell(symbol: string, price: number, quantity: number, timestamp: number): ExecutorFill {
		throw new Error('BinanceExecutor is in skeleton mode. Real-money live trading is disabled.');
	}
}
