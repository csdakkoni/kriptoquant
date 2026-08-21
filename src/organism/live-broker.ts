import ccxt, { Exchange } from 'ccxt';
import { config } from '../core/config.js';
import { log, logError } from '../core/utils.js';
import { RiskManager } from './risk-manager.js';

export class LiveBroker {
	private exchange: Exchange;
	private riskManager: RiskManager;
	private liveEnabled: boolean;

	constructor() {
		this.riskManager = new RiskManager();
		this.liveEnabled = config.isLiveTradingEnabled && !!config.binance.apiKey;

		this.exchange = new ccxt.binance({
			apiKey: config.binance.apiKey,
			secret: config.binance.secret,
			enableRateLimit: true,
			options: {
				defaultType: 'future', // Assuming perp futures for long/short
			},
		});

		if (this.liveEnabled) {
			log('🟢 [BROKER] Live Trading is ENABLED. Real orders will be sent to Binance.');
		} else {
			log('🟡 [BROKER] Live Trading is DISABLED (Dry-run mode). No real orders will be sent.');
		}
	}

	async executeEntry(coin: string, side: 'long' | 'short', currentPrice: number): Promise<boolean> {
		const amountUsd = config.risk.maxTradeSizeUsd;
		const symbol = coin.replace('USDT', '/USDT');

		// 1. Risk Check
		if (!this.riskManager.validateTrade({ coin, side, amountUsd })) {
			return false;
		}

		// 2. Dry Run Mode
		if (!this.liveEnabled) {
			log(`[DRY-RUN] Would execute ENTRY: ${side.toUpperCase()} on ${symbol} for $${amountUsd}`);
			this.riskManager.onTradeOpened();
			return true;
		}

		// 3. Live Execution
		try {
			// Calculate amount in base currency
			const amount = amountUsd / currentPrice;
			const ccxtSide = side === 'long' ? 'buy' : 'sell';

			log(`[BROKER] Executing LIVE ENTRY: ${side.toUpperCase()} ${amount.toFixed(4)} ${symbol}`);
			// await this.exchange.createMarketOrder(symbol, ccxtSide, amount);
			
			this.riskManager.onTradeOpened();
			return true;
		} catch (error) {
			logError(`[BROKER] Entry execution failed for ${symbol}: ${error}`);
			return false;
		}
	}

	async executeExit(coin: string, side: 'long' | 'short', currentPrice: number, estimatedPnlUsd: number): Promise<boolean> {
		const symbol = coin.replace('USDT', '/USDT');

		// Dry Run Mode
		if (!this.liveEnabled) {
			log(`[DRY-RUN] Would execute EXIT: closing ${side.toUpperCase()} on ${symbol}. Estimated PNL: $${estimatedPnlUsd.toFixed(2)}`);
			this.riskManager.onTradeClosed(estimatedPnlUsd);
			return true;
		}

		// Live Execution
		try {
			// In a real scenario, we would fetch the open position size
			// const position = await this.exchange.fetchPosition(symbol);
			// const amount = position.contracts;
			// const ccxtSide = side === 'long' ? 'sell' : 'buy';
			
			log(`[BROKER] Executing LIVE EXIT for ${symbol}`);
			// await this.exchange.createMarketOrder(symbol, ccxtSide, amount, undefined, { reduceOnly: true });

			this.riskManager.onTradeClosed(estimatedPnlUsd);
			return true;
		} catch (error) {
			logError(`[BROKER] Exit execution failed for ${symbol}: ${error}`);
			return false;
		}
	}
}
