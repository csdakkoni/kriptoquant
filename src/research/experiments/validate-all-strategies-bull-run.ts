import { getCandles } from '../../data/binance-client.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';
import { createEmaCrossStrategy } from '../strategies/ema-cross/index.js';
import { createSmaCrossStrategy } from '../strategies/sma-cross/index.js';
import { createStrategyFromConfig } from '../strategies/factory/index.js';
import { runBacktest } from '../backtester.js';
import type { PlatformConfig, RiskConfig, StrategyDefaultsConfig, Strategy } from '../../../core/types.js';

async function run() {
    const startTime = new Date('2023-01-01T00:00:00Z').getTime();
    const endTime = new Date('2024-04-01T00:00:00Z').getTime();

    console.log("Loading BTCUSDT 4h data for the 2023-2024 Bull Run...");
    const candles = await getCandles('BTCUSDT', '4h', startTime, endTime);
    console.log(`Loaded ${candles.length} candles.`);

    const platformConfig: PlatformConfig = {
        initialCapital: 10000,
        commissionPercent: 0.10,
        slippagePercent: 0.05
    };

    const riskConfigRaw: RiskConfig = {
        maxPositionPercent: 100, // Allocate 100% position size for maximum yield potential
        maxDailyLossPercent: 100,
        maxOrderValue: 10000,
        stopLossPercent: 0.05, // 5% stop loss
        takeProfitPercent: 0, // No take profit (let profits run)
        stopLossAtrMultiplier: 0
    };

    // Disabled filters config to check raw edge
    const strategyDefaults: StrategyDefaultsConfig = {
        strategies: {
            emaCross: { fast: 9, slow: 21 },
            smaCross: { fast: 10, slow: 30 }
        },
        filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
        confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
    };

    const testRuns: { name: string, strategy: Strategy }[] = [
        { name: 'EMA Cross (9/21)', strategy: createEmaCrossStrategy(9, 21) },
        { name: 'EMA Cross (20/50)', strategy: createEmaCrossStrategy(20, 50) },
        { name: 'SMA Cross (10/30)', strategy: createSmaCrossStrategy(10, 30) },
        { name: 'SMA Cross (20/50)', strategy: createSmaCrossStrategy(20, 50) },
        { name: 'Donchian Breakout (20)', strategy: createDonchianBreakoutStrategy(20) },
        { name: 'Donchian Breakout (55)', strategy: createDonchianBreakoutStrategy(55) },
        { name: 'Donchian Breakout (100)', strategy: createDonchianBreakoutStrategy(100) },
    ];

    // Compile Supertrend from config
    const supertrendLego = createStrategyFromConfig({
        metadata: { name: "supertrend-trend-lego", version: "1.0.0", tags: [], category: "Trend", author: "" },
        warmupPeriod: 50,
        indicators: [{ id: "st", type: "supertrend", params: [10, 3.0] }],
        filters: [],
        entry: { type: "comparison", operator: "==", left: { type: "indicator", id: "st.direction" }, right: { type: "constant", value: 1 } },
        exit: { type: "comparison", operator: "==", left: { type: "indicator", id: "st.direction" }, right: { type: "constant", value: -1 } }
    } as any, candles).strategy;
    testRuns.push({ name: 'Supertrend (10, 3.0)', strategy: supertrendLego });

    // Compile VWAP Z-Score from config
    const vwapLego = createStrategyFromConfig({
        metadata: { name: "vwap-zscore-lego", version: "1.0.0", tags: [], category: "Mean Reversion", author: "" },
        warmupPeriod: 20,
        indicators: [{ id: "vw", type: "vwap", params: [20] }],
        filters: [],
        entry: { type: "comparison", operator: "<", left: { type: "indicator", id: "vw" }, right: { type: "constant", value: -2.0 } },
        exit: { type: "comparison", operator: ">", left: { type: "indicator", id: "vw" }, right: { type: "constant", value: 2.0 } }
    } as any, candles).strategy;
    testRuns.push({ name: 'VWAP Z-Score (20, 2.0)', strategy: vwapLego });

    // Compile Bollinger Bands from config
    const bbLego = createStrategyFromConfig({
        metadata: { name: "bollinger-bands-lego", version: "1.0.0", tags: [], category: "Mean Reversion", author: "" },
        warmupPeriod: 20,
        indicators: [{ id: "bb", type: "bollinger", params: [20, 2.0] }],
        filters: [],
        entry: { type: "comparison", operator: "<", left: { type: "indicator", id: "close" }, right: { type: "indicator", id: "bb.lower" } },
        exit: { type: "comparison", operator: ">", left: { type: "indicator", id: "close" }, right: { type: "indicator", id: "bb.upper" } }
    } as any, candles).strategy;
    testRuns.push({ name: 'Bollinger Bands (20, 2.0)', strategy: bbLego });

    console.log("\n=== VALIDATION MATRIX ON 2023-2024 BULL RUN ===");
    for (const run of testRuns) {
        try {
            const bt = runBacktest(run.strategy, candles, platformConfig, riskConfigRaw, 'BTCUSDT', strategyDefaults);
            console.log(`- ${run.name.padEnd(26)}: Return: +${bt.totalReturn.toFixed(2)}%, Sharpe: ${bt.sharpeRatio.toFixed(3)}, PF: ${bt.profitFactor.toFixed(3)}, Trades: ${bt.totalTrades} (WR: ${bt.winRate.toFixed(1)}%)`);
        } catch (e: any) {
            console.error(`- ${run.name.padEnd(26)}: FAILED with error: ${e.message}`);
        }
    }
}

run().catch(console.error);
