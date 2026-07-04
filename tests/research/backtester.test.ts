// ============================================================================
// KRIPTOQUANT — Backtester Tests (Reality Engine + Signal Quality Pipeline)
// ============================================================================
// t+1 execution, slippage, filter pipeline, intra-candle stop-loss doğrulamaları.
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle, PlatformConfig, RiskConfig, Strategy } from '../../src/core/types.js';
import { runBacktest } from '../../src/research/backtester.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * 40 mumlu güçlü trend veri seti.
 * Her mum öncekinden yüksek (ADX yüksek olacak).
 * Hacim yüksek ve spike'lı (RVOL filtrelerini geçirecek).
 */
function makeTrendingCandles(count: number = 40): Candle[] {
	return Array.from({ length: count }, (_, i) => {
		const base = 100 + i * 5; // Güçlü yükseliş trendi
		const ts = i * 86400000;
		// Hacim: düşük baz + belirli mumlarda spike (sinyal mumlarında yüksek olacak)
		const volume = i >= 30 ? 5000 : (i >= 20 ? 3000 : 1000);
		return {
			openTime: ts,
			open: base,
			high: base + 8,
			low: base - 2,
			close: base + 4,
			volume,
			closeTime: ts + 86400000 - 1,
		};
	});
}

function makeCandle(
	open: number, high: number, low: number, close: number, dayIndex: number,
): Candle {
	const ts = dayIndex * 86400000;
	return { openTime: ts, open, high, low, close, volume: 1000, closeTime: ts + 86400000 - 1 };
}

const testConfig: PlatformConfig = {
	coins: ['TESTUSDT'],
	defaultInterval: '1d',
	initialCapital: 10000,
	commissionPercent: 0.10,
	slippagePercent: 0.05,
};

const testRisk: RiskConfig = {
	maxPositionPercent: 100,
	maxDailyLossPercent: 50,
	maxOrderValue: 10000,
	stopLossAtrMultiplier: 2,
};

/**
 * Belirli bir mumda BUY sinyali üreten test stratejisi.
 */
function createTestBuyStrategy(signalAtIndex: number): Strategy {
	return {
		name: 'test-buy',
		description: 'Test BUY strategy',
		warmupPeriod: 2,
		evaluate(candles) {
			if (signalAtIndex >= candles.length) return [];
			return [{
				timestamp: candles[signalAtIndex].openTime,
				side: 'BUY' as const,
				price: candles[signalAtIndex].close,
				confidence: 1.0,
				reason: 'Test BUY signal',
			}];
		},
	};
}

/**
 * BUY ve SELL sinyali üreten strateji.
 */
function createTestRoundTripStrategy(buyIndex: number, sellIndex: number): Strategy {
	return {
		name: 'test-roundtrip',
		description: 'Test round trip',
		warmupPeriod: 2,
		evaluate(candles) {
			const signals = [];
			if (buyIndex < candles.length) {
				signals.push({
					timestamp: candles[buyIndex].openTime,
					side: 'BUY' as const,
					price: candles[buyIndex].close,
					confidence: 1.0,
					reason: 'Test BUY',
				});
			}
			if (sellIndex < candles.length) {
				signals.push({
					timestamp: candles[sellIndex].openTime,
					side: 'SELL' as const,
					price: candles[sellIndex].close,
					confidence: 1.0,
					reason: 'Test SELL',
				});
			}
			return signals;
		},
	};
}

// ─── t+1 Execution Tests ────────────────────────────────────────────────────

describe('t+1 execution', () => {
	const candles = makeTrendingCandles(40);

	it('should execute BUY at next candle open, not at signal close', () => {
		// Sinyal index 32'de (yüksek hacim bölgesi, ADX geçerli)
		// Emir index 33'te çalışır
		const strategy = createTestBuyStrategy(32);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		expect(result.trades.length).toBe(1); // Backtest sonu forced close

		const trade = result.trades[0];
		const signalClose = candles[32].close; // 264
		const nextOpen = candles[33].open;     // 265

		// Giriş fiyatı t+1 open civarında olmalı (+ slippage)
		expect(trade.entryOrder.price).toBeGreaterThan(nextOpen - 1);
		// Sinyal close'u olmamalı
		expect(trade.entryOrder.price).not.toBeCloseTo(signalClose, 0);
	});

	it('should execute SELL at next candle open, not at signal close', () => {
		// BUY index 30, SELL index 34
		const strategy = createTestRoundTripStrategy(30, 34);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		if (result.trades.length > 0) {
			const trade = result.trades[0];
			// Giriş t+1 open civarında
			expect(trade.entryOrder.price).toBeGreaterThan(candles[31].open - 1);
			// Sinyal ile kapandıysa çıkış da t+1
			if (trade.exitReason.startsWith('Signal:')) {
				expect(trade.exitOrder.price).toBeGreaterThan(candles[35].open - 2);
			}
		}
	});

	it('should not execute at the same candle as the signal', () => {
		// Sinyal son mumda (index 39) — çalıştırılacak t+1 mum yok
		const strategy = createTestBuyStrategy(39);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		expect(result.totalTrades).toBe(0);
	});
});

// ─── Slippage Tests ──────────────────────────────────────────────────────────

describe('slippage', () => {
	const candles = makeTrendingCandles(40);

	it('should apply buy slippage (price increases)', () => {
		const strategy = createTestBuyStrategy(32);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		if (result.trades.length > 0) {
			const nextOpen = candles[33].open;
			// slippage=0.05% → executionPrice > open
			expect(result.trades[0].entryOrder.price).toBeGreaterThan(nextOpen);
		}
	});

	it('should apply sell slippage (price decreases)', () => {
		const strategy = createTestRoundTripStrategy(30, 34);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		if (result.trades.length > 0 && result.trades[0].exitReason.startsWith('Signal:')) {
			const nextOpen = candles[35].open;
			// slippage=0.05% → exitPrice < open
			expect(result.trades[0].exitOrder.price).toBeLessThan(nextOpen);
		}
	});

	it('should use zero slippage when configured', () => {
		const zeroSlippageConfig = { ...testConfig, slippagePercent: 0 };
		const strategy = createTestBuyStrategy(32);
		const result = runBacktest(strategy, candles, zeroSlippageConfig, testRisk, 'TEST');

		if (result.trades.length > 0) {
			const nextOpen = candles[33].open;
			expect(result.trades[0].entryOrder.price).toBeCloseTo(nextOpen, 2);
		}
	});
});

// ─── Buy & Hold Benchmark ────────────────────────────────────────────────────

describe('buy & hold benchmark', () => {
	const candles = makeTrendingCandles(40);

	it('should calculate B&H return based on first/last candle in trading range', () => {
		const strategy = createTestBuyStrategy(32);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		// warmupPeriod=2, startCandle=candles[2], endCandle=candles[39]
		// B&H = (candles[39].close - candles[2].open) / candles[2].open * 100
		const startOpen = candles[2].open;   // 110
		const endClose = candles[39].close;  // 299
		const expectedBnH = ((endClose - startOpen) / startOpen) * 100;
		expect(result.buyAndHoldReturn).toBeCloseTo(expectedBnH, 0);
	});

	it('should compute alpha = strategy return - B&H return', () => {
		const strategy = createTestBuyStrategy(32);
		const result = runBacktest(strategy, candles, testConfig, testRisk, 'TEST');

		const expectedAlpha = result.totalReturn - result.buyAndHoldReturn;
		expect(result.alpha).toBeCloseTo(expectedAlpha, 1);
	});
});

// ─── Signal Quality Pipeline Tests ──────────────────────────────────────────

describe('signal quality pipeline', () => {
	it('should track rejected signals in result', () => {
		// 10 mumlu kısa veri — ADX/RVOL hesaplanamaz → tüm sinyaller filtrelenir
		const shortCandles: Candle[] = Array.from({ length: 10 }, (_, i) =>
			makeCandle(100 + i * 10, 110 + i * 10, 95 + i * 10, 105 + i * 10, i),
		);

		const strategy = createTestBuyStrategy(3);
		const result = runBacktest(strategy, shortCandles, testConfig, testRisk, 'TEST');

		// Veri kısa → filtreler NaN → sinyal reject edilmeli
		expect(result.totalTrades).toBe(0);
		expect(result.rejectedSignals).toBe(1);
	});
});
