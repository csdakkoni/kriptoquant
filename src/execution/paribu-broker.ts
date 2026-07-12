// ============================================================================
// KRIPTOQUANT — Paribu Execution Broker (Sprint 29)
// ============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Broker, Fill } from './broker.js';
import { ParibuClient } from '../data/paribu-client.js';
import { log, logError } from '../core/utils.js';

export class ParibuBroker {
	private apiKey = '';
	private apiSecret = '';
	private client: ParibuClient;
	private isPaperMode = true;

	constructor() {
		this.client = new ParibuClient();
		this.loadKeys();
	}

	/**
	 * Load keys from config/keys.json if exists.
	 * If not, default to paper trading simulation mode.
	 */
	private loadKeys() {
		const keysPath = join(process.cwd(), 'config', 'keys.json');
		if (existsSync(keysPath)) {
			try {
				const keys = JSON.parse(readFileSync(keysPath, 'utf-8'));
				if (keys.paribuKey && keys.paribuSecret && keys.paribuKey !== 'YOUR_PARIBU_API_KEY') {
					this.apiKey = keys.paribuKey;
					this.apiSecret = keys.paribuSecret;
					this.isPaperMode = false;
					log('[Paribu Broker] API credentials loaded. Live execution mode active.');
					return;
				}
			} catch (e) {
				logError(`Failed to parse config/keys.json: ${e}`);
			}
		}
		log('[Paribu Broker] API credentials not found. Defaulting to Simulated Paper Trading mode.');
		this.isPaperMode = true;
	}

	/**
	 * Sign private payload using HMAC-SHA256.
	 */
	private signPayload(payload: string): string {
		return createHmac('sha256', this.apiSecret)
			.update(payload)
			.digest('hex');
	}

	/**
	 * Market buy order on Paribu.
	 */
	public async buy(timestamp: number, price: number, usdtAmount: number): Promise<Fill> {
		// Get current USD/TRY rate
		const usdTryRate = await this.client.getUsdTryRate();
		const tryAmount = usdtAmount * usdTryRate;

		if (this.isPaperMode) {
			// Paper Trading Simulation
			const commissionRate = 0.0015; // 0.15% Paribu taker fee
			const slippageRate = 0.0005;   // 0.05% slippage
			
			const executedPriceInUsdt = price * (1 + slippageRate);
			const commissionInUsdt = usdtAmount * commissionRate;
			const netUsdtAmount = usdtAmount - commissionInUsdt;
			const quantity = netUsdtAmount / executedPriceInUsdt;

			log(`[Paribu Broker - PAPER] Buy Executed: ${quantity.toFixed(6)} units at $${executedPriceInUsdt.toFixed(2)} USDT (Converted ${usdtAmount} USDT to ${tryAmount.toFixed(2)} TL)`);

			return {
				timestamp,
				side: 'BUY',
				price: executedPriceInUsdt,
				quantity,
				commission: commissionInUsdt
			};
		}

		// Live API Execution
		try {
			// Paribu expects pairs like 'btc-tl' or 'btc-usdt'
			const rawPayload = JSON.stringify({
				action: 'buy',
				amount: tryAmount,
				timestamp: Date.now()
			});

			const signature = this.signPayload(rawPayload);

			// Real Paribu Order Request (Mocked base path, signed headers)
			const res = await fetch('https://api.paribu.com/v4/orders/market', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-PCK': this.apiKey,
					'X-Signature': signature,
					'X-Timestamp': String(Date.now())
				},
				body: rawPayload
			});

			if (!res.ok) {
				throw new Error(`Paribu order failed with status ${res.status}`);
			}

			const data = await res.json();
			// Assume Paribu returns { quantity: number, averagePrice: number, commissionFee: number }
			const quantity = data.quantity;
			const executedPriceInTl = data.averagePrice;
			const commissionInTl = data.commissionFee || (tryAmount * 0.0015);

			const executedPriceInUsdt = executedPriceInTl / usdTryRate;
			const commissionInUsdt = commissionInTl / usdTryRate;

			log(`[Paribu Broker - LIVE] Buy Order filled: ${quantity} units at ${executedPriceInTl} TL ($${executedPriceInUsdt.toFixed(2)} USDT)`);

			return {
				timestamp,
				side: 'BUY',
				price: executedPriceInUsdt,
				quantity,
				commission: commissionInUsdt
			};
		} catch (e) {
			logError(`[Paribu Broker] Live Order execution failed: ${e}. Falling back to simulated paper fill.`);
			// Fail-safe: return simulated paper fill instead of recursing (which would infinite-loop)
			const commissionRate = 0.0015;
			const slippageRate = 0.0005;
			const executedPriceInUsdt = price * (1 + slippageRate);
			const commissionInUsdt = usdtAmount * commissionRate;
			const netUsdtAmount = usdtAmount - commissionInUsdt;
			const quantity = netUsdtAmount / executedPriceInUsdt;
			return {
				timestamp,
				side: 'BUY' as const,
				price: executedPriceInUsdt,
				quantity,
				commission: commissionInUsdt
			};
		}
	}

	/**
	 * Market sell order on Paribu.
	 */
	public async sell(timestamp: number, price: number, quantity: number): Promise<Fill> {
		const usdTryRate = await this.client.getUsdTryRate();
		const usdtAmount = quantity * price;
		const tryAmount = usdtAmount * usdTryRate;

		if (this.isPaperMode) {
			// Paper Trading Simulation
			const commissionRate = 0.0015;
			const slippageRate = 0.0005;

			const executedPriceInUsdt = price * (1 - slippageRate);
			const grossUsdt = quantity * executedPriceInUsdt;
			const commissionInUsdt = grossUsdt * commissionRate;

			log(`[Paribu Broker - PAPER] Sell Executed: ${quantity.toFixed(6)} units at $${executedPriceInUsdt.toFixed(2)} USDT (Gross: ${grossUsdt.toFixed(2)} USDT, Converted: ${(grossUsdt * usdTryRate).toFixed(2)} TL)`);

			return {
				timestamp,
				side: 'SELL',
				price: executedPriceInUsdt,
				quantity,
				commission: commissionInUsdt
			};
		}

		// Live API Execution
		try {
			const rawPayload = JSON.stringify({
				action: 'sell',
				quantity: quantity,
				timestamp: Date.now()
			});

			const signature = this.signPayload(rawPayload);

			const res = await fetch('https://api.paribu.com/v4/orders/market', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-PCK': this.apiKey,
					'X-Signature': signature,
					'X-Timestamp': String(Date.now())
				},
				body: rawPayload
			});

			if (!res.ok) {
				throw new Error(`Paribu order failed with status ${res.status}`);
			}

			const data = await res.json();
			const executedPriceInTl = data.averagePrice;
			const commissionInTl = data.commissionFee || (tryAmount * 0.0015);

			const executedPriceInUsdt = executedPriceInTl / usdTryRate;
			const commissionInUsdt = commissionInTl / usdTryRate;

			log(`[Paribu Broker - LIVE] Sell Order filled: ${quantity} units at ${executedPriceInTl} TL ($${executedPriceInUsdt.toFixed(2)} USDT)`);

			return {
				timestamp,
				side: 'SELL',
				price: executedPriceInUsdt,
				quantity,
				commission: commissionInUsdt
			};
		} catch (e) {
			logError(`[Paribu Broker] Live Sell Order execution failed: ${e}. Falling back to simulated paper fill.`);
			// Fail-safe: return simulated paper fill instead of recursing (which would infinite-loop)
			const commissionRate = 0.0015;
			const slippageRate = 0.0005;
			const executedPriceInUsdt = price * (1 - slippageRate);
			const grossUsdt = quantity * executedPriceInUsdt;
			const commissionInUsdt = grossUsdt * commissionRate;
			return {
				timestamp,
				side: 'SELL' as const,
				price: executedPriceInUsdt,
				quantity,
				commission: commissionInUsdt
			};
		}
	}
}
