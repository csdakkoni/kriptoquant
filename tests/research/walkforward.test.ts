import { describe, it, expect, beforeEach } from 'vitest';
import { WalkForwardEngine } from '../../src/research/walkforward-engine.js';
import type { Candle } from '../../src/core/types.js';

describe('WalkForwardEngine Unit Tests', () => {
	let engine: WalkForwardEngine;

	beforeEach(() => {
		engine = new WalkForwardEngine();
	});

	it('should generate rolling windows with no overlapping out-of-sample data leakage', () => {
		// Mock 100 candles
		const candles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
			openTime: 1000 + i * 60000,
			open: 100 + i,
			high: 102 + i,
			low: 99 + i,
			close: 101 + i,
			volume: 1000,
			closeTime: 1050 + i * 60000,
		}));

		const windows = engine.generateWindows(candles, 0.70, 3);
		expect(windows.length).toBe(3);

		windows.forEach(w => {
			expect(w.inSample.length).toBeGreaterThan(0);
			expect(w.outOfSample.length).toBeGreaterThan(0);
			
			// Verify split boundary (no overlapping between IS and OOS within window)
			const lastIS = w.inSample[w.inSample.length - 1];
			const firstOOS = w.outOfSample[0];
			expect(lastIS.openTime).toBeLessThan(firstOOS.openTime);
		});
	});
});
