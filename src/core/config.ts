import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env from root if it exists
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
	dotenv.config({ path: envPath });
} else {
	dotenv.config();
}

export const config = {
	binance: {
		apiKey: process.env.BINANCE_API_KEY || '',
		secret: process.env.BINANCE_SECRET || '',
		useTestnet: process.env.BINANCE_USE_TESTNET === 'true',
	},
	risk: {
		maxTradeSizeUsd: Number(process.env.MAX_TRADE_SIZE_USD) || 10,
		maxDailyLossUsd: Number(process.env.MAX_DAILY_LOSS_USD) || 5,
		maxOpenTrades: Number(process.env.MAX_OPEN_TRADES) || 3,
		leverage: Number(process.env.LEVERAGE) || 1,
		marginMode: (process.env.MARGIN_MODE || 'ISOLATED').toUpperCase() as 'ISOLATED' | 'CROSSED',
	},
	isLiveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
};
