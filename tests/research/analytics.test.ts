// ============================================================================
// KRIPTOQUANT — Signal Analytics Tests (Sprint 6)
// ============================================================================
// Signal Analyzer, Filter Statistics, Signal CSV Export, Confidence Engine
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle, Signal, FilterConfig, ConfidenceConfig } from '../../src/core/types.js';
import { analyzeSignals, calculateFilterStats, exportSignalJournal } from '../../src/research/analytics/signal-analyzer.js';
import { calculateConfidence } from '../../src/research/confidence/confidence-engine.js';
import { createFilterEngine } from '../../src/research/filters/filter-engine.js';
import { existsSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';

// ─── Test Data ───────────────────────────────────────────────────────────────

const filterConfig: FilterConfig = {
	adxPeriod: 14,
	adxVetoThreshold: 20,
	rvolLookback: 20,
	rvolVetoThreshold: 1.5,
};

const confidenceConfig: ConfidenceConfig = {
	baseScore: 40,
	adxStrongThreshold: 25,
	adxStrongBonus: 30,
	rvolHighThreshold: 2.0,
	rvolHighBonus: 30,
	minimumScore: 70,
};

function makeTrendingCandles(count: number = 40): Candle[] {
	return Array.from({ length: count }, (_, i) => {
		const base = 100 + i * 5;
		const ts = i * 86400000;
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

function makeSignal(timestamp: number, side: 'BUY' | 'SELL', price: number): Signal {
	return {
		timestamp,
		side,
		price,
		confidence: 1.0,
		reason: 'Test signal',
		metadata: { indicatorFast: 100, indicatorSlow: 95 },
	};
}

// ─── Signal Analyzer Tests ───────────────────────────────────────────────────

describe('Signal Analyzer', () => {
	it('should analyze signals and return AnalyzedSignal array', () => {
		const candles = makeTrendingCandles(40);
		const signals: Signal[] = [
			makeSignal(candles[32].openTime, 'BUY', candles[32].close),
		];

		const result = analyzeSignals(
			signals, candles, 'test-strategy', 'BTCUSDT', filterConfig, confidenceConfig,
		);

		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
		expect(result[0].strategy).toBe('test-strategy');
		expect(result[0].direction).toBe('BUY');
		expect(result[0].adx).toBeGreaterThan(0);
		expect(result[0].rvol).toBeGreaterThan(0);
		expect(typeof result[0].accepted).toBe('boolean');
	});

	it('should reject signals with NaN ADX/RVOL (short data)', () => {
		const candles = makeTrendingCandles(10);
		const signals: Signal[] = [
			makeSignal(candles[5].openTime, 'BUY', candles[5].close),
		];

		const result = analyzeSignals(
			signals, candles, 'test', 'TEST', filterConfig, confidenceConfig,
		);

		expect(result[0].accepted).toBe(false);
		expect(result[0].rejectReasons.length).toBeGreaterThan(0);
	});

	it('should carry metadata (indicatorFast/Slow) from signal', () => {
		const candles = makeTrendingCandles(40);
		const signals: Signal[] = [
			{
				...makeSignal(candles[32].openTime, 'BUY', candles[32].close),
				metadata: { indicatorFast: 123.45, indicatorSlow: 120.30 },
			},
		];

		const result = analyzeSignals(
			signals, candles, 'test', 'TEST', filterConfig, confidenceConfig,
		);

		expect(result[0].indicatorFast).toBe(123.45);
		expect(result[0].indicatorSlow).toBe(120.30);
	});
});

// ─── Filter Statistics Tests ─────────────────────────────────────────────────

describe('Filter Statistics', () => {
	it('should count rejections by filter type', () => {
		const candles = makeTrendingCandles(10);
		const signals: Signal[] = [
			makeSignal(candles[3].openTime, 'BUY', candles[3].close),
			makeSignal(candles[5].openTime, 'SELL', candles[5].close),
			makeSignal(candles[7].openTime, 'BUY', candles[7].close),
		];

		const analyzed = analyzeSignals(
			signals, candles, 'test', 'TEST', filterConfig, confidenceConfig,
		);
		const stats = calculateFilterStats(analyzed);

		expect(stats.totalSignals).toBe(3);
		expect(stats.rejected).toBe(3);
		expect(stats.accepted).toBe(0);
		expect(stats.acceptanceRate).toBe(0);
		// Short data → ADX NaN + RVOL NaN → multiple filter rejections
		expect(stats.byFilter.multiple).toBe(3);
	});

	it('should calculate acceptance rate correctly', () => {
		// Use manual analyzed signals to test stats
		const stats = calculateFilterStats([
			{ symbol: 'T', timestamp: 0, date: '', strategy: 't', direction: 'BUY', price: 0, indicatorFast: 0, indicatorSlow: 0, adx: 25, rvol: 2.0, confidenceScore: 70, accepted: true, rejectReasons: [] },
			{ symbol: 'T', timestamp: 1, date: '', strategy: 't', direction: 'SELL', price: 0, indicatorFast: 0, indicatorSlow: 0, adx: 10, rvol: 0.5, confidenceScore: 0, accepted: false, rejectReasons: ['Weak Trend (ADX: 10.0)', 'Low Volume (RVOL: 0.50)'] },
			{ symbol: 'T', timestamp: 2, date: '', strategy: 't', direction: 'BUY', price: 0, indicatorFast: 0, indicatorSlow: 0, adx: 15, rvol: 2.0, confidenceScore: 0, accepted: false, rejectReasons: ['Weak Trend (ADX: 15.0)'] },
		]);

		expect(stats.totalSignals).toBe(3);
		expect(stats.accepted).toBe(1);
		expect(stats.rejected).toBe(2);
		expect(stats.acceptanceRate).toBeCloseTo(33.33, 0);
		expect(stats.byFilter.adx).toBe(1);
		expect(stats.byFilter.multiple).toBe(1);
	});
});

// ─── Signal Journal CSV Tests ────────────────────────────────────────────────

describe('Signal Journal CSV', () => {
	const testPath = 'test-signals-output.csv';

	it('should export valid CSV with header and rows', () => {
		const analyzed = [
			{
				symbol: 'BTCUSDT',
				timestamp: 86400000,
				date: '2024-01-02',
				strategy: 'ema-cross',
				direction: 'BUY' as const,
				price: 45000,
				indicatorFast: 100.5,
				indicatorSlow: 98.3,
				adx: 22.5,
				rvol: 1.8,
				confidenceScore: 70,
				accepted: true,
				rejectReasons: [],
			},
			{
				symbol: 'BTCUSDT',
				timestamp: 172800000,
				date: '2024-01-03',
				strategy: 'ema-cross',
				direction: 'SELL' as const,
				price: 44000,
				indicatorFast: 97.2,
				indicatorSlow: 99.1,
				adx: 15.3,
				rvol: 0.8,
				confidenceScore: 0,
				accepted: false,
				rejectReasons: ['Weak Trend (ADX: 15.3)', 'Low Volume (RVOL: 0.80)'],
			},
		];

		exportSignalJournal(analyzed, testPath);
		expect(existsSync(testPath)).toBe(true);

		const content = readFileSync(testPath, 'utf-8');
		const lines = content.split('\n');

		// Header
		expect(lines[0]).toContain('Timestamp');
		expect(lines[0]).toContain('ADX');
		expect(lines[0]).toContain('Reject Reasons');

		// Data rows
		expect(lines[1]).toContain('ema-cross');
		expect(lines[1]).toContain('BUY');
		expect(lines[1]).toContain('YES');

		expect(lines[2]).toContain('SELL');
		expect(lines[2]).toContain('NO');
		expect(lines[2]).toContain('Weak Trend');

		// Cleanup
		unlinkSync(testPath);
	});
});

// ─── Confidence Engine Tests ─────────────────────────────────────────────────

describe('Confidence Engine (config-driven)', () => {
	it('should return base score when no thresholds met', () => {
		const result = calculateConfidence(15, 1.0, confidenceConfig);
		expect(result.score).toBe(40);
		expect(result.passed).toBe(false);
	});

	it('should add ADX bonus when above threshold', () => {
		const result = calculateConfidence(30, 1.0, confidenceConfig);
		expect(result.score).toBe(70); // 40 + 30
		expect(result.passed).toBe(true);
	});

	it('should add RVOL bonus when above threshold', () => {
		const result = calculateConfidence(15, 2.5, confidenceConfig);
		expect(result.score).toBe(70); // 40 + 30
		expect(result.passed).toBe(true);
	});

	it('should add both bonuses', () => {
		const result = calculateConfidence(30, 2.5, confidenceConfig);
		expect(result.score).toBe(100); // 40 + 30 + 30
		expect(result.passed).toBe(true);
	});

	it('should respect custom config values', () => {
		const customConfig: ConfidenceConfig = {
			baseScore: 50,
			adxStrongThreshold: 30,
			adxStrongBonus: 20,
			rvolHighThreshold: 3.0,
			rvolHighBonus: 20,
			minimumScore: 60,
		};

		const result = calculateConfidence(25, 2.0, customConfig);
		expect(result.score).toBe(50); // Only base
		expect(result.passed).toBe(false); // 50 < 60
	});
});

// ─── Filter Engine Tests (config-driven) ─────────────────────────────────────

describe('Filter Engine (config-driven)', () => {
	it('should use custom thresholds from config', () => {
		const candles = makeTrendingCandles(40);
		// Very lenient config — everything should pass
		const lenientConfig: FilterConfig = {
			adxPeriod: 14,
			adxVetoThreshold: 1, // Almost anything passes
			rvolLookback: 5,
			rvolVetoThreshold: 0.1, // Almost anything passes
		};

		const engine = createFilterEngine(candles, lenientConfig);
		const verdict = engine.evaluate(35);

		expect(verdict.passed).toBe(true);
		expect(verdict.reasons).toHaveLength(0);
	});

	it('should reject with strict thresholds', () => {
		const candles = makeTrendingCandles(40);
		const strictConfig: FilterConfig = {
			adxPeriod: 14,
			adxVetoThreshold: 99, // Almost nothing passes
			rvolLookback: 20,
			rvolVetoThreshold: 99,
		};

		const engine = createFilterEngine(candles, strictConfig);
		const verdict = engine.evaluate(35);

		expect(verdict.passed).toBe(false);
		expect(verdict.reasons.length).toBeGreaterThan(0);
	});
});
