// ============================================================================
// KRIPTOQUANT — Supertrend Indicator Tests (Sprint 16)
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle } from '../../src/core/types.js';
import { supertrend } from '../../src/core/indicators/supertrend.js';

function makeMockCandle(ts: number, close: number, high: number, low: number): Candle {
	return {
		openTime: ts,
		open: close,
		high,
		low,
		close,
		volume: 100,
		closeTime: ts + 999,
	};
}

describe('Supertrend Indicator', () => {
	it('should calculate supertrend direction and values correctly', () => {
		const candles: Candle[] = [];
		// Generate 20 candles with rising prices to ensure ATR warms up and trend turns bullish
		for (let i = 0; i < 20; i++) {
			candles.push(makeMockCandle(i * 1000, 100 + i * 2, 101 + i * 2, 99 + i * 2));
		}

		const res = supertrend(candles, 10, 3.0);
		expect(res.supertrend).toHaveLength(20);
		expect(res.direction).toHaveLength(20);

		// Warmup period: first 10 candles should have NaN supertrend (ATR is NaN)
		for (let i = 0; i < 10; i++) {
			expect(res.supertrend[i]).toBeNaN();
		}

		// After warmup, direction should be 1 (bullish) since prices are steadily rising
		expect(res.direction[15]).toBe(1);
		expect(res.supertrend[15]).toBeLessThan(candles[15].close);

		// Now add a drop candle that should flip trend direction to bearish (-1)
		candles.push(makeMockCandle(20000, 50, 51, 49)); // Large drop to 50
		const res2 = supertrend(candles, 10, 3.0);
		expect(res2.direction[20]).toBe(-1);
		expect(res2.supertrend[20]).toBeGreaterThan(50); // Band should be above price in bearish trend
	});
});
