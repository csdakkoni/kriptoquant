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

	// ── Mum mum execution ────────────────────────────────────────────────
	for (let i = strategy.warmupPeriod; i < candles.length; i++) {
		const candle = candles[i];
		const prevCandle = candles[i - 1];

		// Günlük P&L takibi
		portfolio.updateDay(candle.openTime);

		// İşlem içi en yüksek/en düşük fiyat takibi (Mevcut pozisyonlar için)
		portfolio.positions.updateIntraTradePrices(candle.high, candle.low);

		// ── 1) STOP-LOSS kontrolü (Engine karar verir via StopRule, Broker uygular) ──
		const stopSignal = portfolio.positions.evaluateStopLoss(candle, stopRule);
		if (stopSignal) {
			const fill = broker.sell(candle.openTime, stopSignal.exitPrice, portfolio.positions.getQuantity());
			if (logger) logger.onFill(fill);

			const trade = portfolio.positions.close(fill, stopSignal.reason, coin);
			portfolio.addTrade(trade);
			portfolio.addCapital(fill.quantity * fill.price - fill.commission);
			if (logger) logger.onTrade(trade);
		}

		// ── 2) t+1 SİNYAL YÜRÜTME ──────────────────────────────────────
		const pendingSignal = signalsByTimestamp.get(prevCandle.openTime);
		if (pendingSignal) {
			const analyzed = analyzedByTimestamp.get(prevCandle.openTime);

			if (!analyzed || !analyzed.accepted) {
				portfolio.incrementRejected();
			} else {
				// Risk Engine
				const riskDecision = evaluateRisk(
					pendingSignal, portfolio.getCapital(), portfolio.getDailyPnl(), riskConfig,
				);

				if (riskDecision.approved) {
					if (pendingSignal.side === 'BUY' && !portfolio.positions.hasOpen()) {
						// BUY → Broker'a gönder → Portfolio'ya kaydet
						const fill = broker.buy(candle.openTime, candle.open, riskDecision.positionSize);
						if (logger) logger.onFill(fill);

						const currentAtr = atrValues.length > i && !Number.isNaN(atrValues[i])
							? atrValues[i]
							: 0;
						const stopLoss = currentAtr > 0
							? fill.price - currentAtr * riskConfig.stopLossAtrMultiplier
							: 0;

						portfolio.positions.open(fill, riskDecision.positionSize, currentAtr, stopLoss);
						portfolio.deductCapital(riskDecision.positionSize);

						// Yeni açılan pozisyon için mum içi fiyatları hemen güncelle
						portfolio.positions.updateIntraTradePrices(candle.high, candle.low);

					} else if (pendingSignal.side === 'SELL' && portfolio.positions.hasOpen()) {
						// SELL → Broker'a gönder → Portfolio'yu güncelle
						const fill = broker.sell(candle.openTime, candle.open, portfolio.positions.getQuantity());
						if (logger) logger.onFill(fill);

						const trade = portfolio.positions.close(fill, `Signal: ${pendingSignal.reason}`, coin);
						portfolio.addTrade(trade);
						portfolio.addCapital(fill.quantity * fill.price - fill.commission);
						if (logger) logger.onTrade(trade);
					}
				}
			}
		}

		// ── 3) Equity curve kaydı (mark-to-market) ──────────────────────
		portfolio.positions.updateIntraTradePrices(candle.high, candle.low);
		portfolio.recordEquityPoint(candle.openTime, candle.close);
	}

	// ── Açık pozisyon kaldıysa son fiyattan kapat ────────────────────────
	if (portfolio.positions.hasOpen()) {
		const lastCandle = candles[candles.length - 1];
		const fill = broker.sell(lastCandle.openTime, lastCandle.close, portfolio.positions.getQuantity());
		if (logger) logger.onFill(fill);

		const trade = portfolio.positions.close(fill, 'Backtest End (forced close)', coin);
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

	// Sharpe Ratio
	const tradeReturns = trades.map((t) => t.pnlPercent / 100);
	const avgRet = tradeReturns.length > 0
		? tradeReturns.reduce((s, r) => s + r, 0) / tradeReturns.length
		: 0;
	const stdRet = tradeReturns.length > 1
		? Math.sqrt(tradeReturns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / (tradeReturns.length - 1))
		: 0;
	const sharpeRatio = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0;

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
