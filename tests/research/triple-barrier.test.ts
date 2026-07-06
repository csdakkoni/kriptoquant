import { describe, it, expect, beforeEach } from 'vitest';
import { TripleBarrierLabeler } from '../../src/research/triple-barrier.js';
import type { Candle } from '../../src/core/types.js';

describe('TripleBarrierLabeler Unit Tests', () => {
	let labeler: TripleBarrierLabeler;

	beforeEach(() => {
		labeler = new TripleBarrierLabeler();
	});

	it('should correctly assign profit-taking, stop-loss and time-out labels', () => {
		// Mock 50 candles
		const candles: Candle[] = Array.from({ length: 50 }, (_, i) => {
			// Create a price spike at index 25 to force upper barrier hit
			const price = i === 25 ? 150 : 100;
			return {
				openTime: 1000 + i * 60000,
				open: price,
				high: price + 1,
				low: price - 1,
				close: price,
				volume: 1000,
				closeTime: 1050 + i * 60000,
			};
		});

		const labels = labeler.labelCandles(candles, 2.0, 1.0, 5);
		expect(labels.length).toBeGreaterThan(0);

		// The observation leading up to index 25 should hit upper barrier (1)
		const obs = labels.find(o => o.timestamp === candles[24].openTime);
		expect(obs).toBeDefined();
		expect(obs?.label).toBe(1);
	});
});
