// ============================================================================
// KRIPTOQUANT — Indicator Tests
// ============================================================================

import { describe, expect, it } from 'vitest';
import { sma } from '../../src/core/indicators/sma.js';
import { rsi } from '../../src/core/indicators/rsi.js';
import { ema, macd } from '../../src/core/indicators/macd.js';

// ─── SMA Tests ───────────────────────────────────────────────────────────────

describe('sma', () => {
	it('should calculate SMA correctly for a simple series', () => {
		const values = [1, 2, 3, 4, 5];
		const result = sma(values, 3);

		expect(result[0]).toBeNaN();
		expect(result[1]).toBeNaN();
		expect(result[2]).toBeCloseTo(2, 10); // (1+2+3)/3
		expect(result[3]).toBeCloseTo(3, 10); // (2+3+4)/3
		expect(result[4]).toBeCloseTo(4, 10); // (3+4+5)/3
	});

	it('should handle period equal to data length', () => {
		const values = [10, 20, 30];
		const result = sma(values, 3);

		expect(result[0]).toBeNaN();
		expect(result[1]).toBeNaN();
		expect(result[2]).toBeCloseTo(20, 10);
	});

	it('should handle period of 1 (identity)', () => {
		const values = [5, 10, 15];
		const result = sma(values, 1);

		expect(result[0]).toBeCloseTo(5, 10);
		expect(result[1]).toBeCloseTo(10, 10);
		expect(result[2]).toBeCloseTo(15, 10);
	});

	it('should throw on invalid period', () => {
		expect(() => sma([1, 2, 3], 0)).toThrow();
		expect(() => sma([1, 2, 3], -1)).toThrow();
	});

	it('should throw when period exceeds data length', () => {
		expect(() => sma([1, 2], 5)).toThrow();
	});
});

// ─── RSI Tests ───────────────────────────────────────────────────────────────

describe('rsi', () => {
	it('should return values between 0 and 100', () => {
		// Gerçekçi bir fiyat serisi
		const prices = [
			44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
			46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
			46.22, 45.64,
		];
		const result = rsi(prices, 14);

		for (let i = 14; i < result.length; i++) {
			expect(result[i]).toBeGreaterThanOrEqual(0);
			expect(result[i]).toBeLessThanOrEqual(100);
		}
	});

	it('should return NaN for first period elements', () => {
		const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
		const result = rsi(prices, 14);

		// RSI ilk `period` eleman için NaN döner (indeks 0..13)
		// İlk hesaplanan değer indeks 14'tedir (= period)
		for (let i = 0; i < 14; i++) {
			expect(result[i]).toBeNaN();
		}
		// İndeks 14'te gerçek bir RSI değeri olmalı
		expect(result[14]).not.toBeNaN();
	});

	it('should return 100 when all changes are positive', () => {
		// Sürekli yükselen fiyat
		const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
		const result = rsi(prices, 14);

		// İlk hesaplanan RSI = 100 (tüm değişimler pozitif)
		expect(result[14]).toBeCloseTo(100, 5);
	});

	it('should throw when not enough data', () => {
		expect(() => rsi([1, 2, 3], 14)).toThrow();
	});
});

// ─── EMA Tests ───────────────────────────────────────────────────────────────

describe('ema', () => {
	it('should start with SMA as first value', () => {
		const values = [1, 2, 3, 4, 5];
		const result = ema(values, 3);

		// İlk EMA = SMA(3) = (1+2+3)/3 = 2
		expect(result[2]).toBeCloseTo(2, 10);
	});

	it('should return NaN for initial elements', () => {
		const values = [1, 2, 3, 4, 5];
		const result = ema(values, 3);

		expect(result[0]).toBeNaN();
		expect(result[1]).toBeNaN();
	});

	it('should weight recent values more heavily', () => {
		// EMA son değerlere daha fazla ağırlık verir
		const values = [10, 10, 10, 10, 20]; // Son değer ani yükseliş
		const smaResult = sma(values, 3);
		const emaResult = ema(values, 3);

		// EMA son ani yükselişe SMA'dan daha hızlı tepki vermeli
		const smaLast = smaResult[4]; // (10+10+20)/3 ≈ 13.33
		const emaLast = emaResult[4]; // EMA > SMA olmalı çünkü son değere daha çok ağırlık verir

		expect(emaLast).toBeGreaterThan(smaLast);
	});
});

// ─── MACD Tests ──────────────────────────────────────────────────────────────

describe('macd', () => {
	it('should return macdLine, signalLine, and histogram', () => {
		// 40 veri noktası (MACD için minimum ~34 gerekli: 26 slow + 9 signal - 1)
		const values = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
		const result = macd(values);

		expect(result).toHaveProperty('macdLine');
		expect(result).toHaveProperty('signalLine');
		expect(result).toHaveProperty('histogram');
		expect(result.macdLine).toHaveLength(40);
		expect(result.signalLine).toHaveLength(40);
		expect(result.histogram).toHaveLength(40);
	});

	it('should have NaN at the beginning', () => {
		const values = Array.from({ length: 40 }, (_, i) => 100 + i);
		const result = macd(values);

		// İlk 25 eleman NaN olmalı (slow EMA 26 periyot)
		for (let i = 0; i < 25; i++) {
			expect(result.macdLine[i]).toBeNaN();
		}
	});

	it('should throw when fast >= slow period', () => {
		const values = Array.from({ length: 40 }, (_, i) => 100 + i);
		expect(() => macd(values, 26, 12)).toThrow();
	});

	it('histogram should equal macdLine - signalLine where both are valid', () => {
		const values = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 15);
		const result = macd(values);

		for (let i = 0; i < values.length; i++) {
			if (!Number.isNaN(result.macdLine[i]) && !Number.isNaN(result.signalLine[i])) {
				expect(result.histogram[i]).toBeCloseTo(
					result.macdLine[i] - result.signalLine[i],
					10,
				);
			}
		}
	});
});

// ─── True Range Tests ────────────────────────────────────────────────────────

import { atr, trueRange } from '../../src/core/indicators/atr.js';
import type { Candle } from '../../src/core/types.js';

function makeCandle(open: number, high: number, low: number, close: number, i: number = 0, volume: number = 1000): Candle {
	return { openTime: i * 86400000, open, high, low, close, volume, closeTime: (i + 1) * 86400000 - 1 };
}

describe('trueRange', () => {
	it('should return NaN for first element', () => {
		const candles = [
			makeCandle(100, 110, 90, 105, 0),
			makeCandle(105, 115, 95, 110, 1),
		];
		const result = trueRange(candles);
		expect(result[0]).toBeNaN();
		expect(result[1]).not.toBeNaN();
	});

	it('should calculate TR as max of three components', () => {
		// Candle: H=115, L=95, prevClose=105
		// high-low = 20, |high-prevClose| = 10, |low-prevClose| = 10
		const candles = [
			makeCandle(100, 110, 90, 105, 0),
			makeCandle(105, 115, 95, 110, 1),
		];
		const result = trueRange(candles);
		expect(result[1]).toBeCloseTo(20, 10); // max(20, 10, 10)
	});

	it('should handle gap up (high-prevClose is largest)', () => {
		// Gap up: prevClose=100, H=130, L=120
		// high-low = 10, |high-prevClose| = 30, |low-prevClose| = 20
		const candles = [
			makeCandle(95, 105, 90, 100, 0),
			makeCandle(125, 130, 120, 125, 1),
		];
		const result = trueRange(candles);
		expect(result[1]).toBeCloseTo(30, 10); // max(10, 30, 20)
	});

	it('should handle gap down (low-prevClose is largest)', () => {
		// Gap down: prevClose=100, H=85, L=70
		// high-low = 15, |high-prevClose| = 15, |low-prevClose| = 30
		const candles = [
			makeCandle(95, 105, 90, 100, 0),
			makeCandle(80, 85, 70, 75, 1),
		];
		const result = trueRange(candles);
		expect(result[1]).toBeCloseTo(30, 10); // max(15, 15, 30)
	});

	it('should throw when less than 2 candles', () => {
		expect(() => trueRange([makeCandle(100, 110, 90, 105)])).toThrow();
	});
});

// ─── ATR Tests ───────────────────────────────────────────────────────────────

describe('atr', () => {
	// 20 mumlu test verisi oluştur (yeterli ATR-14 hesabı için)
	const testCandles: Candle[] = Array.from({ length: 20 }, (_, i) => {
		const base = 100 + i * 2;
		return makeCandle(base, base + 5, base - 3, base + 1, i);
	});

	it('should return NaN for first period elements', () => {
		const result = atr(testCandles, 14);

		// ATR ilk hesaplanan değer indeks period'dadır (14)
		// NaN aralığı: 0..period-1 (0..13)
		for (let i = 0; i < 14; i++) {
			expect(result[i]).toBeNaN();
		}
		// İlk hesaplanan değer indeks 14'te
		expect(result[14]).not.toBeNaN();
	});

	it('should return positive values', () => {
		const result = atr(testCandles, 14);

		for (let i = 14; i < result.length; i++) {
			expect(result[i]).toBeGreaterThan(0);
		}
	});

	it('should use Wilder smoothing (values should be smooth)', () => {
		const result = atr(testCandles, 5);

		// ATR değerleri arasındaki fark ani olmamalı
		const validValues = result.filter((v) => !Number.isNaN(v));
		for (let i = 1; i < validValues.length; i++) {
			const change = Math.abs(validValues[i] - validValues[i - 1]);
			// Wilder smoothing sayesinde ardışık ATR değerleri arasındaki fark küçük
			expect(change).toBeLessThan(validValues[i - 1]); // Fark, değerin kendisinden küçük olmalı
		}
	});

	it('should throw on invalid period', () => {
		expect(() => atr(testCandles, 0)).toThrow();
		expect(() => atr(testCandles, -1)).toThrow();
	});

	it('should throw when not enough data', () => {
		const shortCandles = testCandles.slice(0, 5);
		expect(() => atr(shortCandles, 14)).toThrow();
	});
});

// ─── ADX Tests ───────────────────────────────────────────────────────────────

import { adx } from '../../src/core/indicators/adx.js';

describe('adx', () => {
	// 40 mumlu güçlü yükseliş trendi (ADX yüksek olmalı)
	const trendingCandles: Candle[] = Array.from({ length: 40 }, (_, i) => {
		const base = 100 + i * 5;
		return makeCandle(base, base + 8, base - 2, base + 4, i);
	});

	// 40 mumlu yatay piyasa (ADX düşük olmalı)
	const rangingCandles: Candle[] = Array.from({ length: 40 }, (_, i) => {
		const base = 100 + Math.sin(i) * 3;
		return makeCandle(base, base + 2, base - 2, base + (i % 2 === 0 ? 1 : -1), i);
	});

	it('should return NaN for first 2×period elements', () => {
		const result = adx(trendingCandles, 14);

		for (let i = 0; i < 28; i++) {
			expect(result.adx[i]).toBeNaN();
		}
		expect(result.adx[28]).not.toBeNaN();
	});

	it('should return ADX between 0 and 100', () => {
		const result = adx(trendingCandles, 14);

		for (let i = 28; i < result.adx.length; i++) {
			expect(result.adx[i]).toBeGreaterThanOrEqual(0);
			expect(result.adx[i]).toBeLessThanOrEqual(100);
		}
	});

	it('should show high ADX for trending market', () => {
		const result = adx(trendingCandles, 14);
		const lastAdx = result.adx[result.adx.length - 1];
		expect(lastAdx).toBeGreaterThan(25);
	});

	it('should show lower ADX for ranging market', () => {
		const trendResult = adx(trendingCandles, 14);
		const rangeResult = adx(rangingCandles, 14);

		const lastTrend = trendResult.adx[trendResult.adx.length - 1];
		const lastRange = rangeResult.adx[rangeResult.adx.length - 1];

		expect(lastRange).toBeLessThan(lastTrend);
	});

	it('should return +DI and -DI between 0 and 100', () => {
		const result = adx(trendingCandles, 14);

		for (let i = 14; i < result.plusDI.length; i++) {
			if (!Number.isNaN(result.plusDI[i])) {
				expect(result.plusDI[i]).toBeGreaterThanOrEqual(0);
				expect(result.plusDI[i]).toBeLessThanOrEqual(100);
			}
		}
	});

	it('should throw on invalid period', () => {
		expect(() => adx(trendingCandles, 0)).toThrow();
		expect(() => adx(trendingCandles, -1)).toThrow();
	});

	it('should throw when not enough data', () => {
		const shortCandles = trendingCandles.slice(0, 10);
		expect(() => adx(shortCandles, 14)).toThrow();
	});
});
