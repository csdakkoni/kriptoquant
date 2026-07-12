// ============================================================================
// KRIPTOQUANT — Execution Engine (Sprint 12)
// ============================================================================
// Pipeline: Strategy → Filter → Confidence → Risk → Engine → Portfolio → Broker
//
// Engine karar verir (stop-loss, sinyal, risk).
// Portfolio hesabı yönetir.
// Broker emri uygular.
//
// Backtest'te SimulatedBroker, Paper'da PaperBroker, Canlıda BinanceBroker.
// Engine kodu AYNI kalır.
// ============================================================================

import type {
	BacktestResult,
	Candle,
	PlatformConfig,
	RiskConfig,
	StrategyDefaultsConfig,
	Strategy,
} from '../core/types.js';
import { atr } from '../core/indicators/index.js';
import { evaluateRisk } from '../core/risk/risk-manager.js';
import { formatDate, round } from '../core/utils.js';
import { analyzeSignals, calculateFilterStats } from '../research/analytics/signal-analyzer.js';
import type { AnalyzedSignal } from '../research/analytics/signal-analyzer.js';
import type { Broker } from './broker.js';
import { Portfolio } from './portfolio.js';
import { AtrStopRule } from './stop-rule.js';
import type { TradeLogger } from './trade-logger.js';
import { buildAnalyticsSummary } from '../research/analytics/summary.js';
import { DefaultRegimeClassifier } from '../research/regime/classifier.js';
import { analyzeRegimes } from '../research/regime/regime-analyzer.js';
import { runMonteCarlo } from '../research/analytics/monte-carlo.js';

const ATR_PERIOD = 14;

// ─── Execution Engine ────────────────────────────────────────────────────────

/**
 * Unified Execution Engine.
 *
 * Hem backtest hem paper trading hem live trading bu fonksiyonu kullanır.
 * Fark sadece `broker` ve `logger` parametrelerinde.
 *
 * Reality Engine kuralları:
 * - t+1 execution: Sinyal t'de üretilir, emir t+1'de Open fiyatından çalışır
 * - Slippage: Broker uygular
 * - Stop-loss: StopRule (AtrStopRule) tarafından yönetilir, PositionManager tetikler
 * - Gap-down: Open < stop ise çıkış open fiyatından
 * - Buy & Hold: Pasif benchmark
 */
export function runExecution(
	candles: Candle[],
	strategy: Strategy,
	broker: Broker,
	config: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string = '',
	strategyDefaults?: StrategyDefaultsConfig,
	logger?: TradeLogger,
	mcOptions?: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
	},
): BacktestResult {
	const portfolio = new Portfolio(config.initialCapital);
	const stopRule = new AtrStopRule(riskConfig.stopLossAtrMultiplier);

	// ── Warm-up kontrolü ─────────────────────────────────────────────────
	if (candles.length < strategy.warmupPeriod + 1) {
		throw new Error(
			`Yetersiz veri: "${strategy.name}" en az ${strategy.warmupPeriod + 1} mum gerektirir (warmup + 1 t+1 exec), ` +
			`mevcut: ${candles.length}`,
		);
	}

	// ATR hesapla (stop-loss kararı için — Engine bilir, Broker bilmez)
	const atrValues = candles.length >= ATR_PERIOD + 1 ? atr(candles, ATR_PERIOD) : [];

	// Strateji sinyallerini üret
	const signals = strategy.evaluate(candles);

	// Sinyalleri timestamp'e göre Map'e aktar
	const signalsByTimestamp = new Map<number, typeof signals[number]>();
	for (const signal of signals) {
		signalsByTimestamp.set(signal.timestamp, signal);
	}

	// Signal Analyzer — Filter + Confidence pipeline (pre-compute)
	const defaultFilterConfig = { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 };
	const defaultConfidenceConfig = { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: 70 };

	const filterConfig = strategyDefaults?.filters ?? defaultFilterConfig;
	const confidenceConfig = strategyDefaults?.confidence ?? defaultConfidenceConfig;

	const analyzedSignals = analyzeSignals(
		signals, candles, strategy.name, coin, filterConfig, confidenceConfig,
	);

	const analyzedByTimestamp = new Map<number, AnalyzedSignal>();
	for (const a of analyzedSignals) {
		analyzedByTimestamp.set(a.timestamp, a);
	}

	// ── Mum Mum Simülasyon Döngüsü ──────────────────────────────────────
	for (let i = strategy.warmupPeriod; i < candles.length; i++) {
		const candle = candles[i];
		const prevCandle = candles[i - 1];

		portfolio.updateDay(candle.openTime);

		// ── PHASE 1: MARKET OPEN — AÇILIŞ EMİRLERİNİN YÜRÜTÜLMESİ ──
		// t-1 mumunda üretilen sinyal, kronolojik olarak t mumunun AÇILIŞINDA (Open) işlenir.
		const pendingSignal = signalsByTimestamp.get(prevCandle.openTime);
		if (pendingSignal) {
			if (pendingSignal.side === 'SELL' && portfolio.positions.hasOpen()) {
				const fill = broker.sell(candle.openTime, candle.open, portfolio.positions.getQuantity());
				if (logger) logger.onFill(fill);

				const trade = portfolio.positions.close(fill, `Signal: ${pendingSignal.reason}`, coin);
				portfolio.addTrade(trade);
				portfolio.addCapital(fill.quantity * fill.price - fill.commission);
				if (logger) logger.onTrade(trade);
			} 
			else if (pendingSignal.side === 'BUY' && !portfolio.positions.hasOpen()) {
				const analyzed = analyzedByTimestamp.get(prevCandle.openTime);

				if (!analyzed || !analyzed.accepted) {
					portfolio.incrementRejected(); 
				} else {
					// Alternatif Veri Filtresi: Funding Rate Percentile Veto
					const fundingPercentile = prevCandle.fundingPercentile;
					const threshold = riskConfig.fundingPercentileThreshold ?? 0.95;
					const fundingVeto = riskConfig.enableFundingFilter && fundingPercentile !== undefined && fundingPercentile >= threshold;

					if (fundingVeto) {
						portfolio.incrementRejected();
					} else {
						const riskDecision = evaluateRisk(
							pendingSignal, portfolio.getCapital(), portfolio.getDailyPnl(), riskConfig
						);

						if (riskDecision.approved) {
							let finalPositionSize = riskDecision.positionSize;
							if (riskConfig.enableFundingSizing && fundingPercentile !== undefined) {
								if (fundingPercentile >= 0.98) {
									finalPositionSize *= 0.35;
								} else if (fundingPercentile >= 0.95) {
									finalPositionSize *= 0.60;
								} else if (fundingPercentile >= 0.90) {
									finalPositionSize *= 0.85;
								}
							}

							const fill = broker.buy(candle.openTime, candle.open, finalPositionSize);
							if (logger) logger.onFill(fill);

							const lastClosedAtr = (i - 1 >= 0) && atrValues.length > (i - 1) && !Number.isNaN(atrValues[i - 1]) ? atrValues[i - 1] : 0;
							const stopLoss = (lastClosedAtr > 0 && riskConfig.stopLossAtrMultiplier > 0) ? fill.price - lastClosedAtr * riskConfig.stopLossAtrMultiplier : 0;

							// DÜZELTME: Pozisyon açarken gerçek miktar 'fill.quantity' kullanılır ve bütçe/komisyon hesaba katılır
							portfolio.positions.open(fill, fill.quantity, lastClosedAtr, stopLoss);
							const totalCostUsdt = (fill.quantity * fill.price) + fill.commission;
							portfolio.deductCapital(totalCostUsdt);
						}
					}
				}
			}
		}

		// Pozisyon açıldıktan hemen sonra fiyat takip mekanizmasını besle
		portfolio.positions.updateIntraTradePrices(candle.high, candle.low);

		// ── PHASE 2: INTRA-CANDLE — MUM İÇİ HAREKETLER VE STOP/TP DENETİMİ ──
		// Açılışta girilen veya geçmişten taşınan pozisyon, mevcut mumun iğneleriyle anında test edilir.
		if (portfolio.positions.hasOpen()) {
			let exitSignal: { exitPrice: number; reason: string } | null = null;
			const pos = portfolio.positions.getPositionInfo();

			if (strategy.name === 'a2' && pos) {
				const entryPrice = pos.entryPrice;
				const currentAtr = pos.atrAtEntry || (entryPrice * 0.02);

				// 1. Time Exit: check if open for >= 24 hours (86400000 ms)
				const elapsedMs = candle.openTime - pos.entryTimestamp;
				if (elapsedMs >= 24 * 60 * 60 * 1000) {
					exitSignal = { exitPrice: candle.close, reason: 'Time Exit' };
				}

				// 2. Initial Stop Loss check
				if (!exitSignal && candle.low <= portfolio.positions.stopLossPrice) {
					const exitPrice = Math.min(candle.open, portfolio.positions.stopLossPrice);
					exitSignal = {
						exitPrice,
						reason: portfolio.positions.partialExitTriggered ? 'ATR Profit Lock' : 'SL (ATR)'
					};
				}

				// 3. Level 1 Target check (+2 * ATR)
				if (!exitSignal && !portfolio.positions.partialExitTriggered) {
					const level1Target = entryPrice + 2 * currentAtr;
					if (candle.high >= level1Target) {
						// Execute partial TP of 50%
						const fillPrice = Math.max(candle.open, level1Target);
						const fill = broker.sell(candle.openTime, fillPrice, portfolio.positions.getQuantity() / 2);
						if (fill) {
							if (logger) logger.onFill(fill);
							const partialTrade = portfolio.positions.partialClose(fill, 'Partial TP', coin);
							portfolio.addTrade(partialTrade);
							portfolio.addCapital(fill.quantity * fill.price - fill.commission);
							if (logger) logger.onTrade(partialTrade);

							// Move SL to Entry + commission + buffer (roundtrip ~0.25% buffer)
							portfolio.positions.stopLossPrice = entryPrice * 1.0025;
							portfolio.positions.profitStage = 1;
						}
					}
				}

				// 4. Level 2 Target check (+3 * ATR)
				if (!exitSignal && portfolio.positions.partialExitTriggered && portfolio.positions.profitStage < 2) {
					const level2Target = entryPrice + 3 * currentAtr;
					if (candle.high >= level2Target) {
						// Move stop loss to entry + 1.5 * ATR
						portfolio.positions.stopLossPrice = entryPrice + 1.5 * currentAtr;
						portfolio.positions.profitStage = 2;
					}
				}
			} else if (pos) {
				const entryPrice = pos.entryPrice;
				
				// DÜZELTME: Yüzdesel SL/TP girdisi 1'den büyük veya eşitse 100'e bölünür (%5 girdisi 0.05 olarak işlenir)
				const slPct = riskConfig.stopLossPercent && riskConfig.stopLossPercent >= 1 ? riskConfig.stopLossPercent / 100 : riskConfig.stopLossPercent;
				const tpPct = riskConfig.takeProfitPercent && riskConfig.takeProfitPercent >= 1 ? riskConfig.takeProfitPercent / 100 : riskConfig.takeProfitPercent;

				// A) Yüzdesel Stop Loss kontrolü
				if (slPct && slPct > 0) {
					const slPrice = entryPrice * (1 - slPct);
					if (candle.low <= slPrice) {
						exitSignal = {
							exitPrice: candle.open <= slPrice ? candle.open : slPrice,
							reason: `Stop-Loss Percent (-${(slPct * 100).toFixed(1)}%)`,
						};
					}
				}

				// B) Yüzdesel Take Profit kontrolü
				if (!exitSignal && tpPct && tpPct > 0) {
					const tpPrice = entryPrice * (1 + tpPct);
					if (candle.high >= tpPrice) {
						exitSignal = {
							exitPrice: candle.open >= tpPrice ? candle.open : tpPrice,
							reason: `Take-Profit Percent (+${(tpPct * 100).toFixed(1)}%)`,
						};
					}
				}

				// C) ATR Stop Kuralı Kontrolü
				if (!exitSignal) {
					const stopSignal = portfolio.positions.evaluateStopLoss(candle, stopRule);
					if (stopSignal) {
						exitSignal = stopSignal;
					}
				}
			}

			// Eğer mum içinde bir kırılım (SL/TP) yaşandıysa pozisyonu anında tasfiye et
			if (exitSignal) {
				const fill = broker.sell(candle.openTime, exitSignal.exitPrice, portfolio.positions.getQuantity());
				if (logger) logger.onFill(fill);

				const trade = portfolio.positions.close(fill, exitSignal.reason, coin);
				portfolio.addTrade(trade);
				portfolio.addCapital(fill.quantity * fill.price - fill.commission);
				if (logger) logger.onTrade(trade);
			}
		}

		// ── PHASE 3: MARKET CLOSE — GÜN SONU DEĞERLEME ──
		portfolio.recordEquityPoint(candle.openTime, candle.close);
	}

	if (portfolio.positions.hasOpen()) {
		const lastCandle = candles[candles.length - 1];
		const fill = broker.sell(lastCandle.openTime, lastCandle.close, portfolio.positions.getQuantity());
		if (logger) logger.onFill(fill);

		const trade = portfolio.positions.close(fill, 'End of Backtest Force Exit', coin);
		portfolio.addTrade(trade);
		portfolio.addCapital(fill.quantity * fill.price - fill.commission);
		if (logger) logger.onTrade(trade);
	}

	if (logger) {
		logger.flush();
		logger.close();
	}

	// ── Metrikleri hesapla ───────────────────────────────────────────────
	return buildResult(strategy, candles, portfolio, coin, analyzedSignals, mcOptions);
}

// ─── Sonuç Hesaplama ─────────────────────────────────────────────────────────

function buildResult(
	strategy: Strategy,
	candles: Candle[],
	portfolio: Portfolio,
	coin: string,
	analyzedSignals: AnalyzedSignal[],
	mcOptions?: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
	},
): BacktestResult {
	const trades = [...portfolio.getTrades()];
	const equityCurve = [...portfolio.getEquityCurve()];
	const initialCapital = portfolio.getInitialCapital();
	const finalCapital = portfolio.getFinalCapital();

	const startCandle = candles[strategy.warmupPeriod];
	const endCandle = candles[candles.length - 1];
	const buyAndHoldReturn = ((endCandle.close - startCandle.open) / startCandle.open) * 100;
	const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100;
	const alpha = totalReturn - buyAndHoldReturn;

	const winningTrades = trades.filter((t) => t.pnl > 0);
	const losingTrades = trades.filter((t) => t.pnl <= 0);
	const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

	const avgWin = winningTrades.length > 0
		? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length
		: 0;
	const avgLoss = losingTrades.length > 0
		? losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length
		: 0;

	// Sharpe Ratio (Resampled to daily intervals as per Validation Blueprint)
	const dailyEquityMap = new Map<string, number>();
	for (const pt of equityCurve) {
		const dateStr = new Date(pt.timestamp).toISOString().slice(0, 10);
		dailyEquityMap.set(dateStr, pt.equity);
	}
	const sortedDays = Array.from(dailyEquityMap.keys()).sort();
	const dailyEquity = sortedDays.map((d) => dailyEquityMap.get(d)!);

	const dailyReturns: number[] = [];
	for (let i = 1; i < dailyEquity.length; i++) {
		const prev = dailyEquity[i - 1];
		const curr = dailyEquity[i];
		dailyReturns.push(prev > 0 ? (curr - prev) / prev : 0);
	}

	const avgDailyRet = dailyReturns.length > 0
		? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
		: 0;
	const stdDailyRet = dailyReturns.length > 1
		? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgDailyRet) ** 2, 0) / (dailyReturns.length - 1))
		: 0;
	const sharpeRatio = stdDailyRet > 0 ? (avgDailyRet / stdDailyRet) * Math.sqrt(365) : 0;

	// Sortino Ratio (Downside deviation relative to daily returns)
	const negativeReturns = dailyReturns.filter((r) => r < 0);
	const sumSqNegative = negativeReturns.reduce((s, r) => s + r ** 2, 0);
	const stdDown = dailyReturns.length > 0 ? Math.sqrt(sumSqNegative / dailyReturns.length) : 0;
	const sortinoRatio = stdDown > 0 ? (avgDailyRet / stdDown) * Math.sqrt(365) : 0;

	// Calmar Ratio (Annualized return divided by maximum drawdown)
	const numDays = candles.length > 1
		? (candles[candles.length - 1].openTime - candles[0].openTime) / (24 * 60 * 60 * 1000)
		: 0;
	const annualizedReturn = numDays > 30
		? ((finalCapital / initialCapital) ** (365 / numDays) - 1) * 100
		: totalReturn;
	const calmarRatio = portfolio.getMaxDrawdown() > 0 ? annualizedReturn / portfolio.getMaxDrawdown() : 0;

	// Drawdown Duration Metrics (Resampled daily)
	let runningPeak = initialCapital;
	let longestDrawdownDays = 0;
	let currentDrawdownDays = 0;
	let timeUnderWaterDays = 0;

	const completedDrawdownDurations: number[] = [];
	let currentDrawdownDuration = 0;
	let peak = initialCapital;
	let inDrawdown = false;

	for (const eq of dailyEquity) {
		if (eq > peak) {
			peak = eq;
			if (inDrawdown) {
				completedDrawdownDurations.push(currentDrawdownDuration);
				currentDrawdownDuration = 0;
				inDrawdown = false;
			}
		} else if (eq < peak) {
			inDrawdown = true;
			currentDrawdownDuration++;
		}

		if (eq > runningPeak) {
			runningPeak = eq;
		}
		if (eq < runningPeak) {
			timeUnderWaterDays++;
			currentDrawdownDays++;
			if (currentDrawdownDays > longestDrawdownDays) {
				longestDrawdownDays = currentDrawdownDays;
			}
		} else {
			currentDrawdownDays = 0;
		}
	}
	const timeUnderWaterPercent = dailyEquity.length > 0
		? (timeUnderWaterDays / dailyEquity.length) * 100
		: 0;

	let avgRecoveryTimeDays = 0;
	let medianRecoveryTimeDays = 0;
	if (completedDrawdownDurations.length > 0) {
		avgRecoveryTimeDays = completedDrawdownDurations.reduce((s, v) => s + v, 0) / completedDrawdownDurations.length;
		const sorted = [...completedDrawdownDurations].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		medianRecoveryTimeDays = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	}

	// Profit Factor
	const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0);
	const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
	const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

	const filterStats = calculateFilterStats(analyzedSignals);

	return {
		strategyName: strategy.name,
		coin,
		interval: '',
		startDate: formatDate(startCandle.openTime),
		endDate: formatDate(endCandle.openTime),
		initialCapital,
		finalCapital: round(finalCapital),
		totalReturn: round(totalReturn),
		buyAndHoldReturn: round(buyAndHoldReturn),
		alpha: round(alpha),
		totalTrades: trades.length,
		winningTrades: winningTrades.length,
		losingTrades: losingTrades.length,
		rejectedSignals: portfolio.getRejectedCount(),
		winRate: round(winRate),
		avgWin: round(avgWin),
		avgLoss: round(avgLoss),
		maxDrawdown: round(portfolio.getMaxDrawdown()),
		sharpeRatio: round(sharpeRatio, 3),
		sortinoRatio: round(sortinoRatio, 3),
		calmarRatio: round(calmarRatio, 3),
		marRatio: round(calmarRatio, 3), // MAR is equivalent to Calmar over the full period
		longestDrawdownDays,
		timeUnderWaterPercent: round(timeUnderWaterPercent, 2),
		avgRecoveryTimeDays: round(avgRecoveryTimeDays, 1),
		medianRecoveryTimeDays: round(medianRecoveryTimeDays, 1),
		profitFactor: round(profitFactor, 3),
		trades,
		equityCurve,
		filterStats,
		analyzedSignals,
		regimeReport: analyzeRegimes(trades, candles, new DefaultRegimeClassifier()),
		analytics: buildAnalyticsSummary(
			equityCurve,
			trades,
			candles,
			initialCapital,
			finalCapital,
			portfolio.getMaxDrawdown(),
		),
		monteCarlo: runMonteCarlo(
			trades.map((t) => t.pnlPercent),
			initialCapital,
			mcOptions,
		),
	};
}
