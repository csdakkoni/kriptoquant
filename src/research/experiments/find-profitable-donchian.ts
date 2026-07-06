import { readFileSync } from 'node:fs';
import { CSVProvider } from '../../data/csv-provider.js';
import { createDonchianBreakoutStrategy } from '../strategies/donchian-breakout/index.js';
import { runBacktest } from '../backtester.js';
import type { PlatformConfig, RiskConfig, StrategyDefaultsConfig } from '../../../core/types.js';

async function run() {
    const provider = new CSVProvider();
    
    // Load BTCUSDT 1h
    console.log("Loading BTCUSDT 1h data...");
    const candles = await provider.getHistory('BTCUSDT', '1h');
    console.log(`Loaded ${candles.length} candles.`);

    if (candles.length === 0) {
        console.error("No candles found!");
        return;
    }

    const platformConfig: PlatformConfig = {
        initialCapital: 10000,
        commissionPercent: 0.10,
        slippagePercent: 0.05
    };

    const periods = [20, 55, 100, 150, 200];
    const stopLosses = [0, 0.02, 0.04, 0.06, 0.08, 0.10]; // percentage stops
    const takeProfits = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50]; // percentage profits
    const atrMults = [0, 2.0, 3.0, 4.0, 5.0];

    const results = [];

    console.log("Running grid search for Donchian Breakout on BTCUSDT 1h...");

    for (const period of periods) {
        const strategy = createDonchianBreakoutStrategy(period);
        
        for (const sl of stopLosses) {
            for (const tp of takeProfits) {
                for (const atrM of atrMults) {
                    const riskConfig: RiskConfig = {
                        maxPositionPercent: 100, // Allocate 100% position size for maximum yield potential
                        maxDailyLossPercent: 100, // No daily loss limit for pure strategy expectancy evaluation
                        maxOrderValue: 10000, // Allow full size
                        stopLossPercent: sl,
                        takeProfitPercent: tp,
                        stopLossAtrMultiplier: atrM
                    };

                    // Deactivate signal analyzer filters to evaluate RAW strategy edge
                    const strategyDefaults: StrategyDefaultsConfig = {
                        strategies: {
                            emaCross: { fast: 9, slow: 21 },
                            smaCross: { fast: 10, slow: 30 }
                        },
                        filters: {
                            adxPeriod: 14,
                            adxVetoThreshold: 0, // 0 = disabled
                            rvolLookback: 20,
                            rvolVetoThreshold: 0 // 0 = disabled
                        },
                        confidence: {
                            baseScore: 40,
                            adxStrongThreshold: 25,
                            adxStrongBonus: 0,
                            rvolHighThreshold: 2.0,
                            rvolHighBonus: 0,
                            minimumScore: 0 // 0 = disabled
                        }
                    };

                    const backtest = runBacktest(strategy, candles, platformConfig, riskConfig, 'BTCUSDT', strategyDefaults);

                    if (backtest.totalTrades > 5) {
                        results.push({
                            period,
                            sl: sl * 100,
                            tp: tp * 100,
                            atrM,
                            totalReturn: backtest.totalReturn,
                            sharpe: backtest.sharpeRatio,
                            pf: backtest.profitFactor,
                            trades: backtest.totalTrades,
                            winRate: backtest.winRate
                        });
                    }
                }
            }
        }
    }

    console.log(`Grid search finished. Evaluated ${results.length} valid combinations.`);

    // Sort by return
    const topByReturn = [...results].sort((a, b) => b.totalReturn - a.totalReturn).slice(0, 15);
    console.log("\n=== TOP 15 DONCHIAN CONFIGURATIONS BY RETURN ===");
    topByReturn.forEach((r, idx) => {
        console.log(`#${idx+1}: Period: ${r.period}, SL: ${r.sl}%, TP: ${r.tp}%, ATR Mult: ${r.atrM}`);
        console.log(`     Return: ${r.totalReturn.toFixed(2)}%, Sharpe: ${r.sharpe.toFixed(3)}, PF: ${r.pf.toFixed(3)}, Trades: ${r.trades} (WR: ${r.winRate.toFixed(1)}%)`);
    });

    // Sort by Sharpe
    const topBySharpe = [...results].sort((a, b) => b.sharpe - a.sharpe).slice(0, 15);
    console.log("\n=== TOP 15 DONCHIAN CONFIGURATIONS BY SHARPE ===");
    topBySharpe.forEach((r, idx) => {
        console.log(`#${idx+1}: Period: ${r.period}, SL: ${r.sl}%, TP: ${r.tp}%, ATR Mult: ${r.atrM}`);
        console.log(`     Return: ${r.totalReturn.toFixed(2)}%, Sharpe: ${r.sharpe.toFixed(3)}, PF: ${r.pf.toFixed(3)}, Trades: ${r.trades} (WR: ${r.winRate.toFixed(1)}%)`);
    });
}

run().catch(console.error);
