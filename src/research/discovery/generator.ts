// ============================================================================
// KRIPTOQUANT — Strategy Candidate Generator (Sprint 19)
// ============================================================================

import type { StrategyConfig } from '../strategies/factory/types.js';

/**
 * Kombinasyon uzayından geçerli AST StrategyConfig nesneleri üretir.
 *
 * @param count - Üretilecek aday adedi
 */
export function generateCandidates(count: number): StrategyConfig[] {
	const candidates: StrategyConfig[] = [];

	const templates = [
		// 1. Şablon: EMA Crossover + RSI Filtresi
		(fast: number, slow: number, rsiPeriod: number, rsiThresh: number): StrategyConfig => ({
			metadata: {
				name: `ema-cross-${fast}-${slow}`,
				version: '1.0.0',
				description: `EMA Crossover (${fast}/${slow}) with RSI < ${rsiThresh} filter`,
			},
			warmupPeriod: slow + 1,
			indicators: [
				{ id: 'fast', type: 'ema', params: [fast] },
				{ id: 'slow', type: 'ema', params: [slow] },
				{ id: 'rsi', type: 'rsi', params: [rsiPeriod] },
				{ id: 'atr', type: 'atr', params: [14] },
			],
			filters: [
				{
					type: 'comparison',
					operator: '<',
					left: { type: 'indicator', id: 'rsi' },
					right: { type: 'constant', value: rsiThresh },
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
		}),

		// 2. Şablon: Supertrend Yön Takibi + RSI Filtresi
		(atrP: number, mult: number, rsiPeriod: number, rsiThresh: number): StrategyConfig => ({
			metadata: {
				name: `supertrend-${atrP}-${mult}`,
				version: '1.0.0',
				description: `Supertrend (${atrP}/${mult}) Trend with RSI < ${rsiThresh} filter`,
			},
			warmupPeriod: atrP + 2,
			indicators: [
				{ id: 'st', type: 'supertrend', params: [atrP, mult] },
				{ id: 'rsi', type: 'rsi', params: [rsiPeriod] },
				{ id: 'atr', type: 'atr', params: [14] },
			],
			filters: [
				{
					type: 'comparison',
					operator: '<',
					left: { type: 'indicator', id: 'rsi' },
					right: { type: 'constant', value: rsiThresh },
				},
			],
			entry: {
				type: 'comparison',
				operator: '==',
				left: { type: 'indicator', id: 'st.direction' },
				right: { type: 'constant', value: 1 },
			},
			exit: {
				type: 'comparison',
				operator: '==',
				left: { type: 'indicator', id: 'st.direction' },
				right: { type: 'constant', value: -1 },
			},
		}),

		// 3. Şablon: Donchian Breakout + RSI Filtresi
		(dcPeriod: number, rsiPeriod: number, rsiThresh: number): StrategyConfig => ({
			metadata: {
				name: `donchian-${dcPeriod}`,
				version: '1.0.0',
				description: `Donchian Breakout (${dcPeriod}) with RSI < ${rsiThresh} filter`,
			},
			warmupPeriod: dcPeriod + 1,
			indicators: [
				{ id: 'dc', type: 'donchian', params: [dcPeriod] },
				{ id: 'rsi', type: 'rsi', params: [rsiPeriod] },
				{ id: 'atr', type: 'atr', params: [14] },
			],
			filters: [
				{
					type: 'comparison',
					operator: '<',
					left: { type: 'indicator', id: 'rsi' },
					right: { type: 'constant', value: rsiThresh },
				},
			],
			entry: {
				type: 'comparison',
				operator: '>',
				left: { type: 'indicator', id: 'close' },
				right: { type: 'indicator', id: 'dc.upper' },
			},
			exit: {
				type: 'comparison',
				operator: '<',
				left: { type: 'indicator', id: 'close' },
				right: { type: 'indicator', id: 'dc.lower' },
			},
		}),
	];

	// Parametre havuzları
	const fastPeriods = [9, 10, 12, 14, 15];
	const slowPeriods = [21, 24, 26, 30, 40];
	const dcPeriods = [20, 30, 40, 50];
	const rsiPeriods = [14, 21];
	const rsiThresholds = [60, 65, 70, 75];

	for (let i = 0; i < count; i++) {
		const tempIdx = i % templates.length;
		const rsiP = rsiPeriods[Math.floor(Math.random() * rsiPeriods.length)];
		const rsiT = rsiThresholds[Math.floor(Math.random() * rsiThresholds.length)];

		if (tempIdx === 0) {
			const fast = fastPeriods[Math.floor(Math.random() * fastPeriods.length)];
			const slow = slowPeriods[Math.floor(Math.random() * slowPeriods.length)];
			candidates.push(templates[0](fast, slow, rsiP, rsiT));
		} else if (tempIdx === 1) {
			const atrP = 10;
			const mult = 2 + Math.floor(Math.random() * 3); // 2, 3, 4
			candidates.push(templates[1](atrP, mult, rsiP, rsiT));
		} else {
			const dcP = dcPeriods[Math.floor(Math.random() * dcPeriods.length)];
			candidates.push(templates[2](dcP, rsiP, rsiT));
		}
	}

	return candidates;
}
