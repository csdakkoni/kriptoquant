import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from '../../src/decision/decision-engine.js';
import { ScreenerEngine } from '../../src/decision/screener.js';
import { PortfolioEngine } from '../../src/decision/portfolio-engine.js';
import type { Candle } from '../../src/core/types.js';

describe('Sprint 28 Decision Intelligence Engine Tests', () => {
	let decisionEngine: DecisionEngine;

	beforeEach(() => {
		decisionEngine = new DecisionEngine();
	});

	it('should correctly determine weighted consensus signals', () => {
		// Mock 50 candles
		const mockCandles: Candle[] = Array.from({ length: 50 }, (_, i) => ({
			openTime: 1000 + i * 60000,
			open: 100 + i,
			high: 105 + i,
			low: 95 + i,
			close: 102 + i,
			volume: 1000,
			closeTime: 1050 + i * 60000,
		}));

		const res = decisionEngine.evaluateConsensus('SOLUSDT', mockCandles);
		
		// It evaluates and produces a valid signal structure
		expect(res).toBeDefined();
		expect(res.confidence).toBeGreaterThanOrEqual(0);
		expect(res.confidence).toBeLessThanOrEqual(100);
		expect(['BUY', 'SELL', 'WAIT']).toContain(res.signal);
		expect(res.reasons.length).toBeGreaterThan(0);
	});

	it('should properly verify portfolio allocation boundaries', () => {
		const portfolioEngine = new PortfolioEngine();
		const allocations = portfolioEngine.getPortfolioAllocations();

		expect(allocations).toBeDefined();
		expect(allocations.current.length).toBeGreaterThan(0);
		expect(allocations.recommended.length).toBeGreaterThan(0);

		// Recommended allocation sum should not exceed 100%
		let recSum = 0;
		allocations.recommended.forEach(item => {
			recSum += item.percentage;
		});
		expect(recSum).toBe(100);

		// Current allocation sum should equal 100%
		let curSum = 0;
		allocations.current.forEach(item => {
			curSum += item.percentage;
		});
		expect(curSum).toBe(100);
	});
});
