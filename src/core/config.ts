import * as dotenv from 'dotenv';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Root .env dosyasını kesin olarak bul ve override: true ile yükle (PM2 ortam önbelleğini aşar)
const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(currentDir, '../..');
const envPath = existsSync(join(rootDir, '.env'))
	? join(rootDir, '.env')
	: join(process.cwd(), '.env');

if (existsSync(envPath)) {
	dotenv.config({ path: envPath, override: true });
} else {
	dotenv.config({ override: true });
}

export const config = {
	binance: {
		apiKey: process.env.BINANCE_API_KEY || '',
		secret: process.env.BINANCE_SECRET || '',
		useTestnet: process.env.BINANCE_USE_TESTNET === 'true',
	},
	risk: {
		maxTradeSizeUsd: Number(process.env.MAX_TRADE_SIZE_USD) || 50,
		maxDailyLossUsd: Number(process.env.MAX_DAILY_LOSS_USD) || 20,
		maxOpenTrades: Number(process.env.MAX_OPEN_TRADES) || 3,
		leverage: Number(process.env.LEVERAGE) || 1,
		marginMode: (process.env.MARGIN_MODE || 'ISOLATED').toUpperCase() as 'ISOLATED' | 'CROSSED',
	},
	isLiveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
	liveAllExperiments: process.env.LIVE_ALL_EXPERIMENTS === 'true',
};
