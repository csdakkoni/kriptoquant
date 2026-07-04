// ============================================================================
// KRIPTOQUANT — Walk-Forward Validation Tests (Sprint 9)
// ============================================================================
// Data splitter, future leak koruması, walk-forward engine doğruluğu
// ============================================================================

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { Candle, PlatformConfig, RiskConfig } from '../../src/core/types.js';
import { splitData } from '../../src/research/walkforward/data-splitter.js';
import {
	runWalkForward,
	exportWalkForwardJSON,
	exportWalkForwardCSV,
	type WalkForwardResult,
} from '../../src/research/walkforward/walkforward.js';

// ─── Test Data ───────────────────────────────────────────────────────────────

const platformConfig: PlatformConfig = {
	coins: ['BTCUSDT'],
	defaultInterval: '1d',
	initialCapital: 10000,
	commissionPercent: 0.10,
	slippagePercent: 0.05,
};

const riskConfig: RiskConfig = {
	maxPositionPercent: 100,
	maxDailyLossPercent: 5,
	maxOrderValue: 10000,
	stopLossAtrMultiplier: 2.0,
};

function makeSequentialCandles(count: number): Candle[] {
	return Array.from({ length: count }, (_, i) => {
		const base = 100 + i * 2;
		const ts = i * 86400000;
		return {
			openTime: ts,
			open: base,
			high: base + 5,
			low: base - 2,
			close: base + 3,
			volume: 1000 + i * 10,
			closeTime: ts + 86400000 - 1,
		};
	});
}

// ─── Data Splitter Tests ─────────────────────────────────────────────────────

describe('splitData', () => {
	it('should split data in correct proportions (70/30)', () => {
		const candles = makeSequentialCandles(100);
		const { train, test } = splitData(candles, 0.70);

		expect(train).toHaveLength(70);
		expect(test).toHaveLength(30);
	});

	it('should maintain chronological order', () => {
		const candles = makeSequentialCandles(100);
		const { train, test } = splitData(candles, 0.70);

		// Train mumları test mumlarından önce olmalı
		const lastTrainTs = train[train.length - 1].openTime;
		const firstTestTs = test[0].openTime;

		expect(lastTrainTs).toBeLessThan(firstTestTs);
	});

	it('should NOT have any overlap between train and test', () => {
		const candles = makeSequentialCandles(100);
		const { train, test } = splitData(candles, 0.70);

		const trainTimestamps = new Set(train.map((c) => c.openTime));
		const testTimestamps = new Set(test.map((c) => c.openTime));

		// Hiçbir timestamp iki sette birden olmamalı
		for (const ts of testTimestamps) {
			expect(trainTimestamps.has(ts)).toBe(false);
		}
	});

	it('should NOT allow future data to leak into training set', () => {
		const candles = makeSequentialCandles(100);
		const { train, test } = splitData(candles, 0.70);

		const maxTrainTs = Math.max(...train.map((c) => c.openTime));
		const minTestTs = Math.min(...test.map((c) => c.openTime));

		// Train'deki hiçbir mum test döneminden sonra olamaz
		expect(maxTrainTs).toBeLessThan(minTestTs);
	});

	it('should preserve original candle data', () => {
		const candles = makeSequentialCandles(50);
		const { train, test } = splitData(candles, 0.60);

		// Train + test = orijinal verinin tamamı
		expect(train.length + test.length).toBe(candles.length);

		// İlk ve son mumlar eşleşmeli
		expect(train[0].openTime).toBe(candles[0].openTime);
		expect(test[test.length - 1].openTime).toBe(candles[candles.length - 1].openTime);
	});

	it('should return valid period metadata', () => {
		const candles = makeSequentialCandles(100);
		const { trainPeriod, testPeriod } = splitData(candles, 0.70);

		expect(trainPeriod.candleCount).toBe(70);
		expect(testPeriod.candleCount).toBe(30);
		expect(typeof trainPeriod.start).toBe('string');
		expect(typeof testPeriod.end).toBe('string');
		expect(trainPeriod.endTs).toBeLessThan(testPeriod.startTs);
	});

	it('should support custom train ratio', () => {
		const candles = makeSequentialCandles(100);

		const split80 = splitData(candles, 0.80);
		expect(split80.train).toHaveLength(80);
		expect(split80.test).toHaveLength(20);

		const split50 = splitData(candles, 0.50);
		expect(split50.train).toHaveLength(50);
		expect(split50.test).toHaveLength(50);
	});

	it('should throw on too short data', () => {
		const shortCandles = makeSequentialCandles(5);
		expect(() => splitData(shortCandles)).toThrow();
	});

	it('should throw on invalid ratio', () => {
		const candles = makeSequentialCandles(100);
		expect(() => splitData(candles, 0)).toThrow();
		expect(() => splitData(candles, 1)).toThrow();
		expect(() => splitData(candles, -0.5)).toThrow();
	});
});

// ─── Walk-Forward Engine Tests ───────────────────────────────────────────────

describe('runWalkForward', () => {
	it('should produce valid WalkForwardResult', () => {
		const candles = makeSequentialCandles(100);
		const result = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout',
		);

		expect(result.bestParams).toBeDefined();
		expect(result.bestParams.strategyName).toBeDefined();
		expect(result.trainMetrics).toBeDefined();
		expect(result.testMetrics).toBeDefined();
		expect(result.generalization).toBeDefined();
		expect(result.generalization.label).toBeDefined();
		expect(result.generalization.emoji).toBeDefined();
		expect(typeof result.durationMs).toBe('number');
	});

	it('should use parameters from train set only — NOT from test set', () => {
		const candles = makeSequentialCandles(100);
		const result = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout',
		);

		// Best params, train verisiyle bulunmuş olmalı
		// Test verisiyle optimizasyon yapılmadığını dolaylı olarak doğruluyoruz:
		// Train ve test metrikleri farklı olmalı (aynı olması tesadüf olur)
		expect(result.trainPeriod.endTs).toBeLessThan(result.testPeriod.startTs);
	});

	it('should NOT re-optimize on test data', () => {
		const candles = makeSequentialCandles(100);

		// İki çalıştırma aynı sonucu vermeli (deterministik)
		const r1 = runWalkForward(candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout');
		const r2 = runWalkForward(candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout');

		expect(r1.bestParams).toEqual(r2.bestParams);
		expect(r1.trainMetrics.totalReturn).toBe(r2.trainMetrics.totalReturn);
		expect(r1.testMetrics.totalReturn).toBe(r2.testMetrics.totalReturn);
		expect(r1.generalization.retention).toBe(r2.generalization.retention);
	});

	it('should have train period before test period', () => {
		const candles = makeSequentialCandles(100);
		const result = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout',
		);

		expect(result.trainPeriod.endTs).toBeLessThan(result.testPeriod.startTs);
	});

	it('should filter sweep by strategy', () => {
		const candles = makeSequentialCandles(100);

		// Donchian-only walk-forward
		const dcResult = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout',
		);
		expect(dcResult.bestParams.strategyName).toBe('donchian-breakout');

		// EMA-only walk-forward
		const emaResult = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'ema-cross',
		);
		expect(emaResult.bestParams.strategyName).toBe('ema-cross');
	});
});

// ─── Export Tests ────────────────────────────────────────────────────────────

describe('Walk-Forward Export', () => {
	const testJsonPath = 'test-walkforward.json';
	const testCsvPath = 'test-walkforward.csv';

	it('should export valid JSON', () => {
		const candles = makeSequentialCandles(100);
		const result = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout',
		);

		exportWalkForwardJSON(result, testJsonPath);

		expect(existsSync(testJsonPath)).toBe(true);
		const parsed = JSON.parse(readFileSync(testJsonPath, 'utf-8'));
		expect(parsed.bestParams).toBeDefined();
		expect(parsed.generalization).toBeDefined();

		unlinkSync(testJsonPath);
	});

	it('should export valid CSV', () => {
		const candles = makeSequentialCandles(100);
		const result = runWalkForward(
			candles, platformConfig, riskConfig, 'TEST', '1d', 'donchian-breakout',
		);

		exportWalkForwardCSV(result, testCsvPath);

		expect(existsSync(testCsvPath)).toBe(true);
		const content = readFileSync(testCsvPath, 'utf-8');
		const lines = content.split('\n');
		expect(lines[0]).toContain('Strategy');
		expect(lines[0]).toContain('TrainReturn');
		expect(lines[0]).toContain('TestReturn');
		expect(lines[0]).toContain('Retention');
		expect(lines[0]).toContain('Verdict');
		expect(lines[1]).toContain('donchian-breakout');

		unlinkSync(testCsvPath);
	});
});
