// ============================================================================
// KRIPTOQUANT — AST Evaluator (Sprint 16)
// ============================================================================
// ValueExpression ve ConditionConfig tanımlarını dinamik olarak değerlendirir.
// ============================================================================

import type { Candle } from '../../../core/types.js';
import type { ValueExpression, ConditionConfig } from './types.js';

export function evaluateExpression(
	expr: ValueExpression,
	index: number,
	indicatorsData: Map<string, any>,
	candles: Candle[],
): number {
	if (index < 0 || index >= candles.length) {
		return NaN;
	}

	if (expr.type === 'constant') {
		return expr.value;
	}

	if (expr.type === 'indicator') {
		const idLower = expr.id.toLowerCase();
		if (idLower === 'close') return candles[index].close;
		if (idLower === 'open') return candles[index].open;
		if (idLower === 'high') return candles[index].high;
		if (idLower === 'low') return candles[index].low;

		// Dot notation split (ör. "macd.histogram" veya "supertrend.direction")
		const dotIndex = expr.id.indexOf('.');
		if (dotIndex !== -1) {
			const indicatorId = expr.id.slice(0, dotIndex);
			const subField = expr.id.slice(dotIndex + 1);

			const data = indicatorsData.get(indicatorId);
			if (!data || !data[subField]) {
				return NaN;
			}
			return data[subField][index];
		}

		// Standard indicator array
		const data = indicatorsData.get(expr.id);
		if (!data || !Array.isArray(data)) {
			return NaN;
		}
		return data[index];
	}

	if (expr.type === 'binary') {
		const leftVal = evaluateExpression(expr.left, index, indicatorsData, candles);
		const rightVal = evaluateExpression(expr.right, index, indicatorsData, candles);

		if (Number.isNaN(leftVal) || Number.isNaN(rightVal)) {
			return NaN;
		}

		switch (expr.operator) {
			case '+': return leftVal + rightVal;
			case '-': return leftVal - rightVal;
			case '*': return leftVal * rightVal;
			case '/': return rightVal !== 0 ? leftVal / rightVal : NaN;
			default: return NaN;
		}
	}

	return NaN;
}

export function evaluateCondition(
	cond: ConditionConfig,
	index: number,
	indicatorsData: Map<string, any>,
	candles: Candle[],
): boolean {
	if (index < 0 || index >= candles.length) {
		return false;
	}

	if (cond.type === 'logical') {
		if (!cond.conditions || cond.conditions.length === 0) {
			return false;
		}
		if (cond.operator === 'AND') {
			return cond.conditions.every((c) => evaluateCondition(c, index, indicatorsData, candles));
		}
		if (cond.operator === 'OR') {
			return cond.conditions.some((c) => evaluateCondition(c, index, indicatorsData, candles));
		}
		return false;
	}

	if (cond.type === 'comparison') {
		if (!cond.left || !cond.right) {
			return false;
		}
		const leftVal = evaluateExpression(cond.left, index, indicatorsData, candles);
		const rightVal = evaluateExpression(cond.right, index, indicatorsData, candles);

		if (Number.isNaN(leftVal) || Number.isNaN(rightVal)) {
			return false;
		}

		switch (cond.operator) {
			case '>': return leftVal > rightVal;
			case '<': return leftVal < rightVal;
			case '>=': return leftVal >= rightVal;
			case '<=': return leftVal <= rightVal;
			case '==': return leftVal === rightVal;
			default: return false;
		}
	}

	if (cond.type === 'crossover') {
		if (!cond.left || !cond.right || index < 1) {
			return false;
		}
		const currLeft = evaluateExpression(cond.left, index, indicatorsData, candles);
		const currRight = evaluateExpression(cond.right, index, indicatorsData, candles);
		const prevLeft = evaluateExpression(cond.left, index - 1, indicatorsData, candles);
		const prevRight = evaluateExpression(cond.right, index - 1, indicatorsData, candles);

		if (
			Number.isNaN(currLeft) ||
			Number.isNaN(currRight) ||
			Number.isNaN(prevLeft) ||
			Number.isNaN(prevRight)
		) {
			return false;
		}

		if (cond.operator === 'cross-above') {
			return prevLeft <= prevRight && currLeft > currRight;
		}
		if (cond.operator === 'cross-below') {
			return prevLeft >= prevRight && currLeft < currRight;
		}
		return false;
	}

	return false;
}
