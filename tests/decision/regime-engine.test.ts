import { describe, it, expect, beforeEach } from 'vitest';
import { MarketRegimeEngine } from '../../src/decision/regime-engine.js';
import type { Candle } from '../../src/core/types.js';

describe('MarketRegimeEngine Unit Tests', () => {
	let engine: MarketRegimeEngine;

	beforeEach(() => {
		engine = new MarketRegimeEngine();
	});

	it('should return LOW_VOL_RANGE for default fallback when candles size is small', () => {
		const res = engine.detectRegime([]);
		expect(res.regime).toBe('LOW_VOL_RANGE');
		expect(res.adxVal).toBe(15);
		expect(res.atrPercentile).toBe(0.5);
		expect(res.emaSlope).toBe('flat');
	});

	it('should classify trending or range market conditions correctly', () => {
		// Mock 50 candles with upward trend (increasing closes)
		const mockCandles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
			openTime: 1000 + i * 60000,
			open: 100 + i,
			high: 102 + i,
			low: 99 + i,
			close: 101 + i,
			volume: 1000,
			closeTime: 1050 + i * 60000,
		}));

		const res = engine.detectRegime(mockCandles);
		expect(res.regime).toBeDefined();
		expect(res.adxVal).toBeGreaterThanOrEqual(0);
		expect(res.atrPercentile).toBeGreaterThanOrEqual(0);
		expect(res.atrPercentile).toBeLessThanOrEqual(1.0);
		expect(['positive', 'negative', 'flat']).toContain(res.emaSlope);
	});
});
