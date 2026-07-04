// ============================================================================
// KRIPTOQUANT — Strategy Factory & AST Evaluator Tests (Sprint 16)
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Candle, Trade } from '../../src/core/types.js';
import type { StrategyConfig } from '../../src/research/strategies/factory/types.js';
import { evaluateExpression, evaluateCondition } from '../../src/research/strategies/factory/evaluator.js';
import { createStrategyFromConfig } from '../../src/research/strategies/factory/index.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeMockCandle(ts: number, close: number, high: number = close + 1, low: number = close - 1): Candle {
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

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('AST Evaluator — Value Expressions', () => {
	const mockCandles = [
		makeMockCandle(1000, 10),
		makeMockCandle(2000, 20),
	];

	const mockIndicators = new Map<string, any>([
		['fast_ema', [5, 15]],
		['slow_ema', [8, 12]],
		['macd', { histogram: [1, 2] }],
	]);

	it('should evaluate constants and price fields', () => {
		const exprConst = { type: 'constant' as const, value: 5.5 };
		expect(evaluateExpression(exprConst, 0, mockIndicators, mockCandles)).toBe(5.5);

		const exprClose = { type: 'indicator' as const, id: 'close' };
		expect(evaluateExpression(exprClose, 1, mockIndicators, mockCandles)).toBe(20);
	});

	it('should evaluate indicators with dot notation', () => {
		const exprEma = { type: 'indicator' as const, id: 'fast_ema' };
		expect(evaluateExpression(exprEma, 1, mockIndicators, mockCandles)).toBe(15);

		const exprMacdHist = { type: 'indicator' as const, id: 'macd.histogram' };
		expect(evaluateExpression(exprMacdHist, 1, mockIndicators, mockCandles)).toBe(2);
	});

	it('should evaluate binary mathematical expressions', () => {
		// fast_ema * 1.01 at index 1 -> 15 * 1.01 = 15.15
		const exprBinary = {
			type: 'binary' as const,
			operator: '*' as const,
			left: { type: 'indicator' as const, id: 'fast_ema' },
			right: { type: 'constant' as const, value: 1.01 },
		};
		expect(evaluateExpression(exprBinary, 1, mockIndicators, mockCandles)).toBeCloseTo(15.15, 2);
	});
});

describe('AST Evaluator — Condition Evaluations', () => {
	const mockCandles = [
		makeMockCandle(1000, 10),
		makeMockCandle(2000, 20),
	];

	const mockIndicators = new Map<string, any>([
		['fast_ema', [5, 15]],
		['slow_ema', [8, 12]],
	]);

	it('should evaluate comparison operators', () => {
		// fast_ema > slow_ema at index 1 -> 15 > 12 -> true
		const condComp = {
			type: 'comparison' as const,
			operator: '>' as const,
			left: { type: 'indicator' as const, id: 'fast_ema' },
			right: { type: 'indicator' as const, id: 'slow_ema' },
		};
		expect(evaluateCondition(condComp, 1, mockIndicators, mockCandles)).toBe(true);
		expect(evaluateCondition(condComp, 0, mockIndicators, mockCandles)).toBe(false); // 5 > 8 -> false
	});

	it('should evaluate crossovers', () => {
		// fast_ema crosses-above slow_ema at index 1 -> prev: 5 <= 8, curr: 15 > 12 -> true
		const condCross = {
			type: 'crossover' as const,
			operator: 'cross-above' as const,
			left: { type: 'indicator' as const, id: 'fast_ema' },
			right: { type: 'indicator' as const, id: 'slow_ema' },
		};
		expect(evaluateCondition(condCross, 1, mockIndicators, mockCandles)).toBe(true);
	});
});

describe('Strategy Factory Integration', () => {
	const mockConfig: StrategyConfig = {
		metadata: {
			name: 'factory-test-strategy',
			version: '1.0.0',
			tags: ['test'],
		},
		warmupPeriod: 2,
		indicators: [
			{ id: 'fast', type: 'ema', params: [3] },
			{ id: 'slow', type: 'ema', params: [5] },
		],
		filters: [
			// close > 5
			{
				type: 'comparison',
				operator: '>',
				left: { type: 'indicator', id: 'close' },
				right: { type: 'constant', value: 5 },
			},
		],
		entry: {
			type: 'comparison',
			operator: '>',
			left: { type: 'indicator', id: 'fast' },
			right: { type: 'indicator', id: 'slow' },
		},
		exit: {
			type: 'comparison',
			operator: '<',
			left: { type: 'indicator', id: 'fast' },
			right: { type: 'indicator', id: 'slow' },
		},
	};

	it('should build CompiledStrategy, cache indicators, and filter entry signals correctly', () => {
		const candles = [
			makeMockCandle(1000, 100),
			makeMockCandle(2000, 102),
			makeMockCandle(3000, 105),
			makeMockCandle(4000, 108),
			makeMockCandle(5000, 110),
			makeMockCandle(6000, 100), // Drop
		];

		const compiled = createStrategyFromConfig(mockConfig, candles);
		expect(compiled.config.metadata.name).toBe('factory-test-strategy');
		expect(compiled.indicatorsData.has('fast')).toBe(true);
		expect(compiled.indicatorsData.has('slow')).toBe(true);

		const signals = compiled.strategy.evaluate(candles);
		expect(signals.length).toBeGreaterThan(0);
	});
});
