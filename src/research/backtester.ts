// ============================================================================
// KRIPTOQUANT — Backtest Engine (Reality Engine + Signal Quality Pipeline)
// ============================================================================
// Pipeline: Strategy → Filter Engine → Confidence Engine → Risk Engine → Execution
//
// - t+1 execution: Sinyal t mumunda üretilir, emir t+1 mumunun Open'ında çalışır
// - Config-driven commission ve slippage
// - Intra-candle stop-loss
// - Buy & Hold benchmark ve alpha hesaplaması
// ============================================================================

import type {
	BacktestResult,
	Candle,
	EquityPoint,
	Order,
	PlatformConfig,
	RiskConfig,
	StrategyDefaultsConfig,
	Strategy,
	Trade,
} from '../core/types.js';
import { atr } from '../core/indicators/index.js';
import { evaluateRisk } from '../core/risk/risk-manager.js';
import { formatDate, round } from '../core/utils.js';
import { analyzeSignals, calculateFilterStats } from './analytics/signal-analyzer.js';
import type { AnalyzedSignal, FilterStats } from './analytics/signal-analyzer.js';

const ATR_PERIOD = 14;

// ─── Slippage Yardımcıları ───────────────────────────────────────────────────

/**
 * Alış fiyatına slippage ekler (yukarı kayma).
 */
function applyBuySlippage(price: number, slippagePercent: number): number {
	return price * (1 + slippagePercent / 100);
}

/**
 * Satış fiyatına slippage uygular (aşağı kayma).
 */
function applySellSlippage(price: number, slippagePercent: number): number {
	return price * (1 - slippagePercent / 100);
}

// ─── Açık Pozisyon Durumu ────────────────────────────────────────────────────

interface OpenPosition {
	quantity: number;
	entryOrder: Order;
	entryCommission: number;
	atrAtEntry: number;
	stopLossPrice: number;
}

// ─── Trade Oluşturma ────────────────────────────────────────────────────────

function closeTrade(
	position: OpenPosition,
	exitTimestamp: number,
	exitPrice: number,
	exitReason: string,
	commissionRate: number,
	coin: string,
): { trade: Trade; netValue: number } {
	const grossValue = position.quantity * exitPrice;
	const exitCommission = grossValue * commissionRate;
	const netValue = grossValue - exitCommission;

	const grossPnl = position.quantity * (exitPrice - position.entryOrder.price);
	const totalCommission = position.entryCommission + exitCommission;
	const netPnl = netValue - position.entryOrder.value;
	const pnlPercent = (netPnl / position.entryOrder.value) * 100;

	const exitOrder: Order = {
		timestamp: exitTimestamp,
		side: 'SELL',
		price: exitPrice,
		quantity: position.quantity,
		value: netValue,
	};

	const trade: Trade = {
		asset: coin,
		entryOrder: position.entryOrder,
		exitOrder,
		positionSize: position.entryOrder.value,
		commission: round(totalCommission, 4),
		grossPnl: round(grossPnl, 4),
		pnl: round(netPnl, 4),
		pnlPercent: round(pnlPercent, 4),
		holdingPeriod: exitTimestamp - position.entryOrder.timestamp,
		atrAtEntry: round(position.atrAtEntry, 4),
		exitReason,
	};

	return { trade, netValue };
}

// ─── Ana Backtest Fonksiyonu ─────────────────────────────────────────────────

/**
 * Backtest'i çalıştırır.
 *
 * Reality Engine kuralları:
 * - t+1 execution: Sinyal t'de üretilir, emir t+1'de Open fiyatından çalışır
 * - Slippage: Alış yukarı kayar (+%), satış aşağı kayar (-%)
 * - Intra-candle stop-loss: Mum.low <= stop ise stop tetiklenir
 * - Gap-down: Mum.open < stop ise çıkış open fiyatından (+ slippage)
 * - Buy & Hold: Pasif karşılaştırma benchmark'ı
 */
export function runBacktest(
	strategy: Strategy,
	candles: Candle[],
	config: PlatformConfig,
	riskConfig: RiskConfig,
	coin: string = '',
	strategyDefaults?: StrategyDefaultsConfig,
): BacktestResult {
	const { initialCapital, commissionPercent, slippagePercent } = config;
	const commissionRate = commissionPercent / 100;

	// ── Warm-up kontrolü ─────────────────────────────────────────────────
	if (candles.length < strategy.warmupPeriod + 1) {
		throw new Error(
			`Yetersiz veri: "${strategy.name}" en az ${strategy.warmupPeriod + 1} mum gerektirir (warmup + 1 t+1 exec), ` +
			`mevcut: ${candles.length}`,
		);
	}

	// ATR hesapla (stop-loss için)
	const atrValues = candles.length >= ATR_PERIOD + 1 ? atr(candles, ATR_PERIOD) : [];

	// Strateji sinyallerini üret
	const signals = strategy.evaluate(candles);

	// Sinyalleri timestamp'e göre Map'e aktar
	const signalsByTimestamp = new Map<number, typeof signals[number]>();
	for (const signal of signals) {
		signalsByTimestamp.set(signal.timestamp, signal);
	}

	// Signal Analyzer — tüm sinyalleri analiz et (pre-compute)
	const defaultFilterConfig = { adxPeriod: 14, adxVetoThreshold: 20, rvolLookback: 20, rvolVetoThreshold: 1.5 };
	const defaultConfidenceConfig = { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 30, rvolHighThreshold: 2.0, rvolHighBonus: 30, minimumScore: 70 };

	const filterConfig = strategyDefaults?.filters ?? defaultFilterConfig;
	const confidenceConfig = strategyDefaults?.confidence ?? defaultConfidenceConfig;

	const analyzedSignals = analyzeSignals(
		signals, candles, strategy.name, coin, filterConfig, confidenceConfig,
	);

	// Timestamp → AnalyzedSignal lookup
	const analyzedByTimestamp = new Map<number, AnalyzedSignal>();
	for (const a of analyzedSignals) {
		analyzedByTimestamp.set(a.timestamp, a);
	}

	// ── Simülasyon durumu ─────────────────────────────────────────────────
	let capital = initialCapital;
	let position: OpenPosition | null = null;
	let dailyPnl = 0;
	let currentDay = '';
	let peakCapital = initialCapital;
	let maxDrawdown = 0;
	let rejectedCount = 0;

	const trades: Trade[] = [];
	const equityCurve: EquityPoint[] = [];

	// ── Mum mum simülasyon ───────────────────────────────────────────────
	// warmupPeriod+1'den başla: warmupPeriod mumu stratejinin ilk sinyal üretebildiği,
	// warmupPeriod+1 de o sinyalin t+1 olarak çalıştırılabildiği ilk mum.
	for (let i = strategy.warmupPeriod; i < candles.length; i++) {
		const candle = candles[i];
		const prevCandle = candles[i - 1];

		// Günlük P&L takibi (UTC)
		const candleDay = formatDate(candle.openTime);
		if (candleDay !== currentDay) {
			currentDay = candleDay;
			dailyPnl = 0;
		}

		// ── 1) Intra-candle STOP-LOSS kontrolü ───────────────────────────
		// Stop-loss, sinyal işlemeden ÖNCE kontrol edilir.
		if (position !== null && position.stopLossPrice > 0 && candle.low <= position.stopLossPrice) {
			let exitPrice: number;
			let exitReason: string;

			if (candle.open <= position.stopLossPrice) {
				// Gap-down: Mum direkt stop seviyesinin altında açıldı
				exitPrice = applySellSlippage(candle.open, slippagePercent);
				exitReason = `Stop-Loss Gap-Down (open=${candle.open.toFixed(2)} < stop=${position.stopLossPrice.toFixed(2)})`;
			} else {
				// Normal stop tetiklenmesi
				exitPrice = applySellSlippage(position.stopLossPrice, slippagePercent);
				exitReason = `Stop-Loss (ATR×${riskConfig.stopLossAtrMultiplier})`;
			}

			const { trade, netValue } = closeTrade(position, candle.openTime, exitPrice, exitReason, commissionRate, coin);
			trades.push(trade);
			capital += netValue;
			dailyPnl += trade.pnl;
			position = null;

			if (capital > peakCapital) peakCapital = capital;
			const dd = ((peakCapital - capital) / peakCapital) * 100;
			if (dd > maxDrawdown) maxDrawdown = dd;
		}

		// ── 2) t+1 SİNYAL YÜRÜTME (Pipeline) ───────────────────────────────
		// Önceki mumda (t) üretilen sinyali bu mumun (t+1) Open fiyatından çalıştır.
		const pendingSignal = signalsByTimestamp.get(prevCandle.openTime);
		if (pendingSignal) {
			// Pre-analyzed sinyali kontrol et
			const analyzed = analyzedByTimestamp.get(prevCandle.openTime);

			if (!analyzed || !analyzed.accepted) {
				rejectedCount++;
			} else {
				// ── Risk Engine ───────────────────────────────────────────
				const riskDecision = evaluateRisk(pendingSignal, capital, dailyPnl, riskConfig);

				if (riskDecision.approved) {
					if (pendingSignal.side === 'BUY' && position === null) {
						const executionPrice = applyBuySlippage(candle.open, slippagePercent);
						const orderValue = riskDecision.positionSize;
						const commission = orderValue * commissionRate;
						const netCost = orderValue - commission;
						const quantity = netCost / executionPrice;

						const currentAtr = atrValues.length > i && !Number.isNaN(atrValues[i])
							? atrValues[i]
							: 0;

						const stopLoss = currentAtr > 0
							? executionPrice - currentAtr * riskConfig.stopLossAtrMultiplier
							: 0;

						position = {
							quantity,
							entryOrder: {
								timestamp: candle.openTime,
								side: 'BUY',
								price: executionPrice,
								quantity,
								value: orderValue,
							},
							entryCommission: commission,
							atrAtEntry: currentAtr,
							stopLossPrice: stopLoss,
						};
						capital -= orderValue;

					} else if (pendingSignal.side === 'SELL' && position !== null) {
						const executionPrice = applySellSlippage(candle.open, slippagePercent);

						const { trade, netValue: tradeNet } = closeTrade(
							position, candle.openTime, executionPrice,
							`Signal: ${pendingSignal.reason}`, commissionRate, coin,
						);
						trades.push(trade);
						capital += tradeNet;
						dailyPnl += trade.pnl;
						position = null;

						if (capital > peakCapital) peakCapital = capital;
						const dd = ((peakCapital - capital) / peakCapital) * 100;
						if (dd > maxDrawdown) maxDrawdown = dd;
					}
				}
			}
		}

		// ── 3) Equity curve kaydı (mark-to-market) ──────────────────────
		const openPositionValue = position !== null ? position.quantity * candle.close : 0;
		const currentEquity = round(capital + openPositionValue, 2);
		if (currentEquity > peakCapital) peakCapital = currentEquity;
		const currentDrawdown = round(((peakCapital - currentEquity) / peakCapital) * 100, 2);
		if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
		const currentReturn = round(((currentEquity - initialCapital) / initialCapital) * 100, 2);

		equityCurve.push({
			timestamp: candle.openTime,
			equity: currentEquity,
			drawdownPercent: currentDrawdown,
			returnPercent: currentReturn,
		});
	}

	// ── Açık pozisyon kaldıysa son fiyattan kapat ────────────────────────
	if (position !== null) {
		const lastCandle = candles[candles.length - 1];
		const exitPrice = applySellSlippage(lastCandle.close, slippagePercent);

		const { trade, netValue } = closeTrade(
			position, lastCandle.openTime, exitPrice,
			'Backtest End (forced close)', commissionRate, coin,
		);
		trades.push(trade);
		capital += netValue;
	}

	// ── Buy & Hold Benchmark ─────────────────────────────────────────────
	const startCandle = candles[strategy.warmupPeriod];
	const endCandle = candles[candles.length - 1];
	const buyAndHoldReturn = ((endCandle.close - startCandle.open) / startCandle.open) * 100;

	// ── Metrikleri hesapla ───────────────────────────────────────────────
	const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
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
		finalCapital: round(capital),
		totalReturn: round(totalReturn),
		buyAndHoldReturn: round(buyAndHoldReturn),
		alpha: round(alpha),
		totalTrades: trades.length,
		winningTrades: winningTrades.length,
		losingTrades: losingTrades.length,
		rejectedSignals: rejectedCount,
		winRate: round(winRate),
		avgWin: round(avgWin),
		avgLoss: round(avgLoss),
		maxDrawdown: round(maxDrawdown),
		sharpeRatio: round(sharpeRatio, 3),
		profitFactor: round(profitFactor, 3),
		trades,
		equityCurve,
		filterStats,
		analyzedSignals,
	};
}
