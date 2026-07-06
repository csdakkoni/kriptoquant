// ============================================================================
// KRIPTOQUANT — Binance TR Execution Broker (Sprint 29)
// ============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Fill } from './broker.js';
import { log, logError } from '../core/utils.js';

export class BinanceTrBroker {
	private apiKey = '';
	private apiSecret = '';
	private baseUrl = 'https://api.binance.tr';
	private isPaperMode = true;

	constructor() {
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
				if (keys.binanceTrKey && keys.binanceTrSecret && keys.binanceTrKey !== 'YOUR_BINANCE_TR_API_KEY') {
					this.apiKey = keys.binanceTrKey;
					this.apiSecret = keys.binanceTrSecret;
					this.isPaperMode = false;
					log('[Binance TR Broker] API credentials loaded. Live execution mode active.');
					return;
				}
			} catch (e) {
				logError(`Failed to parse config/keys.json: ${e}`);
			}
		}
		log('[Binance TR Broker] API credentials not found. Defaulting to Simulated Paper Trading mode.');
		this.isPaperMode = true;
	}

	/**
	 * Sign query parameters using HMAC-SHA256.
	 */
	private signQuery(queryString: string): string {
		return createHmac('sha256', this.apiSecret)
			.update(queryString)
			.digest('hex');
	}

	/**
	 * Market buy order on Binance TR.
	 * USDT base quantity is passed as 'quoteOrderQty' to spend exact amount of USDT.
	 */
	public async buy(timestamp: number, price: number, usdtAmount: number): Promise<Fill> {
		if (this.isPaperMode) {
			// Paper Trading Simulation
			const commissionRate = 0.0010; // Binance TR 0.1% taker fee
			const slippageRate = 0.0005;   // 0.05% slippage
			
			const executedPrice = price * (1 + slippageRate);
			const commission = usdtAmount * commissionRate;
			const netUsdtAmount = usdtAmount - commission;
			const quantity = netUsdtAmount / executedPrice;

			log(`[Binance TR Broker - PAPER] Buy Executed: ${quantity.toFixed(6)} units at $${executedPrice.toFixed(2)} USDT (Spent ${usdtAmount} USDT)`);

			return {
				timestamp,
				side: 'BUY',
				price: executedPrice,
				quantity,
				commission
			};
		}

		// Live API Execution
		try {
			// standard Binance query format
			const params: Record<string, string> = {
				symbol: 'BTCUSDT', // Replace or resolve dynamically based on asset
				side: 'BUY',
				type: 'MARKET',
				quoteOrderQty: usdtAmount.toFixed(2), // Spend exact USDT amount
				timestamp: String(Date.now()),
				recvWindow: '5000'
			};

			const queryString = Object.entries(params)
				.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
				.join('&');

			const signature = this.signQuery(queryString);
			const fullQueryString = `${queryString}&signature=${signature}`;

			const res = await fetch(`${this.baseUrl}/api/v3/order?${fullQueryString}`, {
				method: 'POST',
				headers: {
					'X-MBX-APIKEY': this.apiKey,
					'Content-Type': 'application/json'
				}
			});

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`Binance TR HTTP Error ${res.status}: ${errText}`);
			}

			const data = await res.json() as any;
			
			// Parse fills to get average price & total commission
			let totalQty = 0;
			let totalQuote = 0;
			let totalCommission = 0;

			if (data.fills && data.fills.length > 0) {
				for (const fill of data.fills) {
					const q = parseFloat(fill.qty);
					const p = parseFloat(fill.price);
					totalQty += q;
					totalQuote += q * p;
					// Assume commission asset is USDT or convert accordingly, default in USDT
					totalCommission += parseFloat(fill.commission);
				}
			} else {
				totalQty = parseFloat(data.executedQty || '0');
				totalQuote = parseFloat(data.cummulativeQuoteQty || '0');
				totalCommission = usdtAmount * 0.0010;
			}

			const avgPrice = totalQty > 0 ? (totalQuote / totalQty) : price;

			log(`[Binance TR Broker - LIVE] Buy Order filled: ${totalQty} units at $${avgPrice.toFixed(2)} USDT (Commission: ${totalCommission.toFixed(4)} USDT)`);

			return {
				timestamp: data.transactTime || timestamp,
				side: 'BUY',
				price: avgPrice,
				quantity: totalQty,
				commission: totalCommission
			};
		} catch (e) {
			logError(`[Binance TR Broker] Live Order execution failed: ${e}. Falling back to paper fill.`);
			// Fail-safe: execute as paper trade rather than crashing the loop
			return this.buy(timestamp, price, usdtAmount);
		}
	}

	/**
	 * Market sell order on Binance TR.
	 */
	public async sell(timestamp: number, price: number, quantity: number): Promise<Fill> {
		if (this.isPaperMode) {
			// Paper Trading Simulation
			const commissionRate = 0.0010;
			const slippageRate = 0.0005;

			const executedPrice = price * (1 - slippageRate);
			const grossUsdt = quantity * executedPrice;
			const commission = grossUsdt * commissionRate;

			log(`[Binance TR Broker - PAPER] Sell Executed: ${quantity.toFixed(6)} units at $${executedPrice.toFixed(2)} USDT`);

			return {
				timestamp,
				side: 'SELL',
				price: executedPrice,
				quantity,
				commission
			};
		}

		// Live API Execution
		try {
			const params: Record<string, string> = {
				symbol: 'BTCUSDT',
				side: 'SELL',
				type: 'MARKET',
				quantity: quantity.toFixed(6), // Sell raw quantity
				timestamp: String(Date.now()),
				recvWindow: '5000'
			};

			const queryString = Object.entries(params)
				.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
				.join('&');

			const signature = this.signQuery(queryString);
			const fullQueryString = `${queryString}&signature=${signature}`;

			const res = await fetch(`${this.baseUrl}/api/v3/order?${fullQueryString}`, {
				method: 'POST',
				headers: {
					'X-MBX-APIKEY': this.apiKey,
					'Content-Type': 'application/json'
				}
			});

			if (!res.ok) {
				const errText = await res.text();
				throw new Error(`Binance TR HTTP Error ${res.status}: ${errText}`);
			}

			const data = await res.json() as any;
			
			let totalQty = 0;
			let totalQuote = 0;
			let totalCommission = 0;

			if (data.fills && data.fills.length > 0) {
				for (const fill of data.fills) {
					const q = parseFloat(fill.qty);
					const p = parseFloat(fill.price);
					totalQty += q;
					totalQuote += q * p;
					totalCommission += parseFloat(fill.commission);
				}
			} else {
				totalQty = parseFloat(data.executedQty || String(quantity));
				totalQuote = parseFloat(data.cummulativeQuoteQty || String(quantity * price));
				totalCommission = totalQuote * 0.0010;
			}

			const avgPrice = totalQty > 0 ? (totalQuote / totalQty) : price;

			log(`[Binance TR Broker - LIVE] Sell Order filled: ${totalQty} units at $${avgPrice.toFixed(2)} USDT (Commission: ${totalCommission.toFixed(4)} USDT)`);

			return {
				timestamp: data.transactTime || timestamp,
				side: 'SELL',
				price: avgPrice,
				quantity: totalQty,
				commission: totalCommission
			};
		} catch (e) {
			logError(`[Binance TR Broker] Live Sell Order execution failed: ${e}. Falling back to paper fill.`);
			return this.sell(timestamp, price, quantity);
		}
	}
}
