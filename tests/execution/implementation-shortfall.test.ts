import { describe, it, expect, beforeEach } from 'vitest';
import { ImplementationShortfallAnalyzer } from '../../src/execution/implementation-shortfall.js';

describe('ImplementationShortfallAnalyzer Unit Tests', () => {
	let analyzer: ImplementationShortfallAnalyzer;

	beforeEach(() => {
		analyzer = new ImplementationShortfallAnalyzer();
	});

	it('should calculate implementation shortfall and basis points slippage correctly', () => {
		const report = analyzer.analyzeShortfall(100.0, 100.1, 100.3, 10, 'BUY', 5.0);
		
		expect(report.decisionPrice).toBe(100.0);
		expect(report.arrivalPrice).toBe(100.1);
		expect(report.executionPrice).toBe(100.3);
		expect(report.quantity).toBe(10);
		expect(report.slippageUsdt).toBeCloseTo(2.0, 2); // (100.3 - 100.1) * 10
		expect(report.implementationShortfallUsdt).toBeCloseTo(8.0, 2); // (100.3 - 100.0) * 10 + 5.0 fee
		expect(report.implementationShortfallBps).toBeCloseTo(80.0, 1); // 8 / 1000 * 10000
	});
});
