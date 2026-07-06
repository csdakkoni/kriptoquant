import { describe, it, expect, beforeEach } from 'vitest';
import { FillSimulator } from '../../src/execution/fill-simulator.js';
import type { Candle } from '../../src/core/types.js';

describe('FillSimulator Unit Tests', () => {
	let simulator: FillSimulator;

	beforeEach(() => {
		simulator = new FillSimulator();
	});

	it('should simulate fill latency price slippage and potential partial fills', () => {
		const candle: Candle = {
			openTime: Date.now(),
			open: 100,
			high: 105,
			low: 95,
			close: 101,
			volume: 5000,
			closeTime: Date.now() + 60000
		};

		const res = simulator.simulateOrderFill(101, candle, 200, 10000);
		expect(res.originalPrice).toBe(101);
		expect(res.simulatedFillPrice).toBeGreaterThanOrEqual(95);
		expect(res.simulatedFillPrice).toBeLessThanOrEqual(105);
		expect(res.fillRatio).toBe(1.0);
	});

	it('should enforce partial fills for very large trade sizes during volatility spikes', () => {
		const candle: Candle = {
			openTime: Date.now(),
			open: 100,
			high: 110, // high volatility range
			low: 90,
			close: 102,
			volume: 1000,
			closeTime: Date.now() + 60000
		};

		const res = simulator.simulateOrderFill(102, candle, 150, 100000); // 100k big order
		expect(res.fillRatio).toBeLessThan(1.0);
	});
});
