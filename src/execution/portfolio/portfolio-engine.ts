// ============================================================================
// KRIPTOQUANT — Portfolio Simülasyon Motoru (Sprint 18)
// ============================================================================
// Çoklu varlıkların kronolojik zaman akışında, belirlenen sınırlama
// ve sermaye dağılım kurallarına göre işlem yürütmesini yönetir.
// ============================================================================

import type { Candle, Trade, EquityPoint, PlatformConfig, RiskConfig, Strategy, Fill, Order } from '../../core/types.js';
import type { AlignedTimelineStep, AllocationStrategy, PortfolioConstraints } from './types.js';
import { PositionBook } from './position-book.js';
import { round } from '../../core/utils.js';
import { buildAnalyticsSummary } from '../../research/analytics/summary.js';
import { runMonteCarlo } from '../../research/analytics/monte-carlo.js';

/**
 * Zaman hizalı çizelge üzerinden çoklu varlık portföy backtest'i çalıştırır.
 */
export function runPortfolioExecution(
	alignedTimeline: AlignedTimelineStep[],
	candlesMap: Map<string, Candle[]>,
	strategies: Map<string, Strategy>,
	allocation: AllocationStrategy,
	config: PlatformConfig,
	riskConfig: RiskConfig,
	constraints: PortfolioConstraints,
	mcOptions?: {
		readonly method?: 'bootstrap' | 'shuffle';
		readonly simulationsCount?: number;
		readonly ruinThresholdPercent?: number;
	}
): any {
	const initialCapital = config.initialCapital;
	const commissionPercent = config.commissionPercent;
	const slippagePercent = config.slippagePercent;

	const positionBook = new PositionBook();
	let cash = initialCapital;
	let equity = initialCapital;

	const equityCurve: EquityPoint[] = [];

	// Sinyalleri enstrüman bazlı önceden hesapla
	const signalsByCoinAndTime = new Map<string, Map<number, 'BUY' | 'SELL' | 'HOLD'>>();
	for (const [coin, strategy] of strategies.entries()) {
		const coinCandles = candlesMap.get(coin) ?? [];
		const signals = strategy.evaluate(coinCandles);
		const timeMap = new Map<number, 'BUY' | 'SELL' | 'HOLD'>();
		for (const s of signals) {
			timeMap.set(s.timestamp, s.side as 'BUY' | 'SELL');
		}
		signalsByCoinAndTime.set(coin, timeMap);
	}

	for (const step of alignedTimeline) {
		const timestamp = step.timestamp;
		const candleMap = step.candles;

		// 1) Stop-Loss Kontrolleri (Öncelikli Aşama)
		const stops = positionBook.evaluateStops(candleMap);
		for (const stop of stops) {
			const coin = stop.coin;
			const quantity = positionBook.getQuantity(coin);
			if (quantity <= 0) continue;

			// Çıkış emri & fill simülasyonu
			const exitPrice = stop.price;
			const fillPrice = exitPrice * (1 - slippagePercent / 100);
			const exitOrder: Order = {
				timestamp,
				type: 'MARKET',
				side: 'SELL',
				price: fillPrice,
				quantity,
			};
			const commission = quantity * fillPrice * (commissionPercent / 100);
			const fill: Fill = {
				timestamp,
				order: exitOrder,
				price: fillPrice,
				quantity,
				commission,
			};

			positionBook.close(coin, fill, stop.reason);
			cash += (quantity * fillPrice) - commission;
		}

		// 2) Strateji Sinyal Değerlendirme & Yürütme
		for (const [coin, candle] of candleMap.entries()) {
			const strategy = strategies.get(coin);
			if (!strategy) continue;

			// Isınma (warmup) kontrolü
			const coinCandles = candlesMap.get(coin) ?? [];
			const candleIdx = coinCandles.indexOf(candle);
			if (candleIdx < strategy.warmupPeriod) continue;

			// Sinyal kontrolü
			const signal = signalsByCoinAndTime.get(coin)?.get(timestamp) ?? 'HOLD';

			if (signal === 'BUY') {
				// Sınırlama kontrolleri
				if (constraints.preventDoublePosition && positionBook.hasOpen(coin)) continue;
				if (positionBook.getOpenCount() >= constraints.maxPositions) continue;

				// ATR değeri (varsa stratejiden al, yoksa dinamik hesapla)
				let atr = (strategy as any).indicatorsData?.get('atr')?.[candleIdx];
				if (atr === undefined || atr === 0 || Number.isNaN(atr)) {
					const coinCandles = candlesMap.get(coin) ?? [];
					if (coinCandles.length >= 15 && candleIdx >= 14) {
						let sum = 0;
						for (let k = candleIdx - 13; k <= candleIdx; k++) {
							const c = coinCandles[k];
							const prevC = coinCandles[k - 1];
							const tr = prevC
								? Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close))
								: c.high - c.low;
							sum += tr;
						}
						atr = sum / 14;
					} else {
						atr = candle.close * 0.02 / (riskConfig.stopLossAtrMultiplier ?? 2.0);
					}
				}

				// Sermaye dağıtım boyutu
				const allocSize = allocation.allocate(coin, candle.close, atr, {
					cash,
					equity,
					openPositionsCount: positionBook.getOpenCount(),
					maxPositions: constraints.maxPositions,
				});

				if (allocSize > 0 && cash >= allocSize) {
					// Giriş emri & fill simülasyonu
					const fillPrice = candle.close * (1 + slippagePercent / 100);
					const buyOrder: Order = {
						timestamp,
						type: 'MARKET',
						side: 'BUY',
						price: fillPrice,
						quantity: 0,
					};

					const allocAfterCommission = allocSize * (1 - commissionPercent / 100);
					const quantity = allocAfterCommission / fillPrice;
					buyOrder.quantity = quantity;

					const commission = allocSize * (commissionPercent / 100);
					const fill: Fill = {
						timestamp,
						order: buyOrder,
						price: fillPrice,
						quantity,
						commission,
					};

					// Başlangıç stop-loss fiyatı
					const stopMultiplier = riskConfig.stopLossAtrMultiplier ?? 2.0;
					const stopLossPrice = fillPrice - (atr * stopMultiplier);

					positionBook.open(coin, fill, atr, stopLossPrice);
					cash -= allocSize;
				}
			} else if (signal === 'SELL') {
				if (positionBook.hasOpen(coin)) {
					const quantity = positionBook.getQuantity(coin);
					if (quantity > 0) {
						const fillPrice = candle.close * (1 - slippagePercent / 100);
						const sellOrder: Order = {
							timestamp,
							type: 'MARKET',
							side: 'SELL',
							price: fillPrice,
							quantity,
						};
						const grossVal = quantity * fillPrice;
						const commission = grossVal * (commissionPercent / 100);
						const fill: Fill = {
							timestamp,
							order: sellOrder,
							price: fillPrice,
							quantity,
							commission,
						};

						positionBook.close(coin, fill, 'Strategy Signal (SELL)');
						cash += grossVal - commission;
					}
				}
			}
		}

		// 3) Mark to Market Portföy Değerlemesi
		equity = cash + positionBook.getMarkToMarketValue(candleMap);
		equityCurve.push({
			timestamp,
			equity,
			drawdownPercent: 0,
			returnPercent: ((equity - initialCapital) / initialCapital) * 100,
		});
	}

	// 4) Vade Sonu Pozisyon Kapatma (Forced Close)
	if (alignedTimeline.length > 0) {
		const lastStep = alignedTimeline[alignedTimeline.length - 1];
		const timestamp = lastStep.timestamp;
		const candleMap = lastStep.candles;

		for (const coin of strategies.keys()) {
			if (positionBook.hasOpen(coin)) {
				const quantity = positionBook.getQuantity(coin);
				const candle = candleMap.get(coin);
				const exitPrice = candle ? candle.close : lastStep.timestamp;
				const fillPrice = exitPrice * (1 - slippagePercent / 100);

				const forceOrder: Order = {
					timestamp,
					type: 'MARKET',
					side: 'SELL',
					price: fillPrice,
					quantity,
				};
				const grossVal = quantity * fillPrice;
				const commission = grossVal * (commissionPercent / 100);
				const fill: Fill = {
					timestamp,
					order: forceOrder,
					price: fillPrice,
					quantity,
					commission,
				};

				positionBook.close(coin, fill, 'Backtest End (forced close)');
				cash += grossVal - commission;
			}
		}

		equity = cash;
		if (equityCurve.length > 0) {
			equityCurve[equityCurve.length - 1] = {
				timestamp,
				equity,
				drawdownPercent: 0,
				returnPercent: ((equity - initialCapital) / initialCapital) * 100,
			};
		}
	}

	// Drawdown hesaplamaları
	let peak = initialCapital;
	let maxDrawdown = 0;
	for (const ep of equityCurve) {
		if (ep.equity > peak) {
			peak = ep.equity;
		}
		const dd = peak > 0 ? ((peak - ep.equity) / peak) * 100 : 0;
		(ep as any).drawdownPercent = dd;
		if (dd > maxDrawdown) {
			maxDrawdown = dd;
		}
	}

	const trades = positionBook.getTrades();
	const winningTrades = trades.filter((t) => t.pnl > 0);
	const losingTrades = trades.filter((t) => t.pnl <= 0);
	const totalReturn = ((equity - initialCapital) / initialCapital) * 100;
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

	// Buy & Hold Benchmark (equally weighted average across assets)
	let totalBah = 0;
	let count = 0;
	for (const list of candlesMap.values()) {
		if (list.length > 1) {
			const startCandle = list[0];
			const endCandle = list[list.length - 1];
			const bah = ((endCandle.close - startCandle.open) / startCandle.open) * 100;
			totalBah += bah;
			count++;
		}
	}
	const buyAndHoldReturn = count > 0 ? totalBah / count : 0;
	const alpha = totalReturn - buyAndHoldReturn;

	// Profit Factor
	const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
	const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
	const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

	// Exposure Time için yapay mum serisi
	const dummyCandles: Candle[] = alignedTimeline.map((step) => {
		const firstVal = step.candles.values().next().value;
		return firstVal ?? {
			openTime: step.timestamp,
			closeTime: step.timestamp + 86400000,
			open: 1,
			high: 1,
			low: 1,
			close: 1,
			volume: 1,
		};
	});

	// Canonical metrik üretimi
	const analytics = buildAnalyticsSummary(
		equityCurve,
		trades,
		dummyCandles,
		initialCapital,
		equity,
		maxDrawdown,
	);

	// Monte Carlo
	const monteCarlo = runMonteCarlo(
		trades.map((t) => t.pnlPercent),
		initialCapital,
		mcOptions,
	);

	return {
		initialCapital,
		finalCapital: round(equity),
		totalReturn: round(totalReturn),
		buyAndHoldReturn: round(buyAndHoldReturn),
		alpha: round(alpha),
		totalTrades: trades.length,
		winningTrades: winningTrades.length,
		losingTrades: losingTrades.length,
		winRate: round(winRate),
		avgWin: round(avgWin),
		avgLoss: round(avgLoss),
		profitFactor: round(profitFactor, 3),
		sharpeRatio: round(sharpeRatio, 3),
		maxDrawdown: round(maxDrawdown),
		trades,
		equityCurve,
		analytics,
		monteCarlo,
	};
}
