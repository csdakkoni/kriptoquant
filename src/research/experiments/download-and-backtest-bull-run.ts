import { getCandles } from '../../data/binance-client.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';
import { runBacktest } from '../backtester.js';
import type { PlatformConfig, RiskConfig, StrategyDefaultsConfig } from '../../../core/types.js';

async function run() {
    // January 1, 2023 to April 1, 2024 (Peak of bull run)
    const startTime = new Date('2023-01-01T00:00:00Z').getTime();
    const endTime = new Date('2024-04-01T00:00:00Z').getTime();

    console.log("Downloading historical BTCUSDT 4h data for the 2023-2024 Bull Run...");
    const candles = await getCandles('BTCUSDT', '4h', startTime, endTime);
    console.log(`Successfully downloaded ${candles.length} candles.`);

    if (candles.length === 0) {
        console.error("No candles downloaded.");
        return;
    }

    const platformConfig: PlatformConfig = {
        initialCapital: 10000,
        commissionPercent: 0.10,
        slippagePercent: 0.05
    };

    // Calculate buy and hold return
    const first = candles[0];
    const last = candles[candles.length - 1];
    const buyAndHold = ((last.close - first.close) / first.close) * 100;
    console.log(`\n=== Bull Run Market Stats ===`);
    console.log(`Start Price: $${first.close}`);
    console.log(`End Price  : $${last.close}`);
    console.log(`Buy & Hold Return: +${buyAndHold.toFixed(2)}%`);

    const periods = [20, 55, 100];
    
    console.log(`\n=== Backtesting Donchian Breakout on Bull Run ===`);
    for (const period of periods) {
        const strategy = createDonchianBreakoutStrategy(period);

        // 1) Test WITHOUT fixed take-profits (Let Profits Run - True Trend Following!)
        const riskConfigRaw: RiskConfig = {
            maxPositionPercent: 100, // Trade with 100% position size for clear visual compounding
            maxDailyLossPercent: 100,
            maxOrderValue: 10000,
            stopLossPercent: 0.05, // 5% stop loss
            takeProfitPercent: 0, // NO TAKE PROFIT CAP (True trend following!)
            stopLossAtrMultiplier: 0
        };

        const strategyDefaults: StrategyDefaultsConfig = {
            strategies: {
                emaCross: { fast: 9, slow: 21 },
                smaCross: { fast: 10, slow: 30 }
            },
            filters: {
                adxPeriod: 14,
                adxVetoThreshold: 0,
                rvolLookback: 20,
                rvolVetoThreshold: 0
            },
            confidence: {
                baseScore: 40,
                adxStrongThreshold: 25,
                adxStrongBonus: 0,
                rvolHighThreshold: 2.0,
                rvolHighBonus: 0,
                minimumScore: 0
            }
        };

        const rawBacktest = runBacktest(strategy, candles, platformConfig, riskConfigRaw, 'BTCUSDT', strategyDefaults);

        console.log(`\nDonchian Breakout (Period: ${period}) - Let Profits Run (No TP Cap):`);
        console.log(`  Return        : +${rawBacktest.totalReturn.toFixed(2)}%`);
        console.log(`  Sharpe Ratio  : ${rawBacktest.sharpeRatio.toFixed(3)}`);
        console.log(`  Profit Factor : ${rawBacktest.profitFactor.toFixed(3)}`);
        console.log(`  Total Trades  : ${rawBacktest.totalTrades}`);
        console.log(`  Win Rate      : ${rawBacktest.winRate.toFixed(1)}%`);
        console.log(`  Max Drawdown  : ${rawBacktest.maxDrawdown.toFixed(2)}%`);

        // 2) Test WITH standard TP cap of 15% (Cutting profits short)
        const riskConfigWithTP: RiskConfig = {
            ...riskConfigRaw,
            takeProfitPercent: 0.15 // 15% TP Cap
        };

        const tpBacktest = runBacktest(strategy, candles, platformConfig, riskConfigWithTP, 'BTCUSDT', strategyDefaults);
        console.log(`Donchian Breakout (Period: ${period}) - With 15% TP Cap (Cutting Profits Short):`);
        console.log(`  Return        : +${tpBacktest.totalReturn.toFixed(2)}%`);
        console.log(`  Sharpe Ratio  : ${tpBacktest.sharpeRatio.toFixed(3)}`);
        console.log(`  Profit Factor : ${tpBacktest.profitFactor.toFixed(3)}`);
        console.log(`  Total Trades  : ${tpBacktest.totalTrades}`);
        console.log(`  Win Rate      : ${tpBacktest.winRate.toFixed(1)}%`);
    }
}

run().catch(console.error);
