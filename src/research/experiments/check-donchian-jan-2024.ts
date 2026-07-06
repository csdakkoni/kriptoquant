import { getCandles } from '../../data/binance-client.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';
import { runBacktest } from '../backtester.js';
import type { PlatformConfig, RiskConfig, StrategyDefaultsConfig } from '../../../core/types.js';

async function run() {
    const startTime = new Date('2023-01-01T00:00:00Z').getTime();
    const endTime = new Date('2024-01-01T00:00:00Z').getTime();
    const candles = await getCandles('BTCUSDT', '4h', startTime, endTime);

    const platformConfig: PlatformConfig = {
        initialCapital: 10000,
        commissionPercent: 0.10,
        slippagePercent: 0.05
    };

    const strategy = createDonchianBreakoutStrategy(20);
    const riskConfig: RiskConfig = {
        maxPositionPercent: 100,
        maxDailyLossPercent: 100,
        maxOrderValue: 10000,
        stopLossPercent: 0,
        takeProfitPercent: 0,
        stopLossAtrMultiplier: 0
    };

    const strategyDefaults: StrategyDefaultsConfig = {
        strategies: {
            emaCross: { fast: 9, slow: 21 },
            smaCross: { fast: 10, slow: 30 }
        },
        filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
        confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
    };

    const result = runBacktest(strategy, candles, platformConfig, riskConfig, 'BTCUSDT', strategyDefaults);
    console.log(`Donchian Breakout (20) from Jan 1 2023 to Jan 1 2024 (SL:0, TP:0):`);
    console.log(`  Return       : +${result.totalReturn.toFixed(2)}%`);
    console.log(`  Trades       : ${result.totalTrades}`);
    console.log(`  Win Rate     : ${result.winRate.toFixed(1)}%`);
}

run().catch(console.error);
