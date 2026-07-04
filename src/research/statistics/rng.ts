// ============================================================================
// KRIPTOQUANT — Random Number Generators (Sprint 17)
// ============================================================================

export interface RandomGenerator {
	/**
	 * 0 (dahil) ile 1 (hariç) arasında rastgele bir sayı döndürür.
	 */
	next(): number;
}

/**
 * Standard Math.random() tabanlı rastgele sayı üreticisi.
 */
export class MathRandomGenerator implements RandomGenerator {
	next(): number {
		return Math.random();
	}
}

/**
 * LCG (Linear Congruential Generator) tabanlı seed'lenebilir rastgele sayı üreticisi.
 * Testlerde determinizm sağlamak için kullanılır.
 */
export class SeededLcgRandomGenerator implements RandomGenerator {
	private seed: number;

	constructor(seed: number = 42) {
		this.seed = seed;
	}

	next(): number {
		// Numerical Recipes parameters
		this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
		return this.seed / 4294967296;
	}
}
