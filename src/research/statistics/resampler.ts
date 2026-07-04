// ============================================================================
// KRIPTOQUANT — Bootstrap and Shuffle Resamplers (Sprint 17)
// ============================================================================

import type { RandomGenerator } from './rng.js';

/**
 * Verilen getiri dizisinden yerine koyarak (resampling with replacement)
 * rastgele örnekleme yapar. Orijinal dizi uzunluğuyla aynı boyutta döner.
 */
export function bootstrapResample(values: number[], rng: RandomGenerator): number[] {
	const length = values.length;
	if (length === 0) return [];
	
	const resampled: number[] = [];
	for (let i = 0; i < length; i++) {
		const randIdx = Math.floor(rng.next() * length);
		resampled.push(values[randIdx]);
	}
	return resampled;
}

/**
 * Verilen dizinin sırasını Fisher-Yates karıştırma algoritmasıyla rastgele değiştirir.
 * Dizideki değerleri birebir korur (Sequence Risk analizi için).
 */
export function shuffleResample(values: number[], rng: RandomGenerator): number[] {
	const shuffled = [...values];
	const length = shuffled.length;
	if (length <= 1) return shuffled;

	for (let i = length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		const temp = shuffled[i];
		shuffled[i] = shuffled[j];
		shuffled[j] = temp;
	}
	return shuffled;
}
