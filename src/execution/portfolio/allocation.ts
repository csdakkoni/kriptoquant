// ============================================================================
// KRIPTOQUANT — Allocation Strategies (Sprint 18)
// ============================================================================

import type { AllocationStrategy, AllocationContext } from './types.js';

/**
 * Eşit Ağırlıklı (Equal Weight) Sermaye Dağıtımı.
 * Her pozisyon için ayrılan bütçe: Toplam Portföy Değeri / Maksimum Pozisyon Sayısı
 */
export class EqualWeightAllocation implements AllocationStrategy {
	allocate(coin: string, entryPrice: number, atr: number, context: AllocationContext): number {
		if (context.maxPositions <= 0) return 0;
		const allocated = context.equity / context.maxPositions;
		// Fiziksel nakit limitini aşamayız
		return Math.min(context.cash, allocated);
	}
}

/**
 * ATR-Tabanlı Risk Bütçelendirme (Risk Budgeting) Dağıtımı.
 * Her işlemde toplam portföy değerinin en fazla belirli bir yüzdesi (ör. %1) riske atılır.
 * Pozisyon büyüklüğü ATR mesafesine göre ayarlanır.
 */
export class RiskBudgetAllocation implements AllocationStrategy {
	private readonly riskPercent: number;
	private readonly atrMultiplier: number;

	constructor(riskPercent: number = 1.0, atrMultiplier: number = 2.0) {
		this.riskPercent = riskPercent;
		this.atrMultiplier = atrMultiplier;
	}

	allocate(coin: string, entryPrice: number, atrValue: number, context: AllocationContext): number {
		if (atrValue <= 0 || entryPrice <= 0) {
			// Fallback: ATR yoksa equal weight kullan
			return Math.min(context.cash, context.equity / context.maxPositions);
		}

		// Riske atılacak maksimum nominal tutar (ör. 10,000 USDT için %1 = 100 USDT)
		const riskAmount = context.equity * (this.riskPercent / 100);

		// Coin başına risk (USDT) = ATR * Çarpan
		const riskPerCoin = atrValue * this.atrMultiplier;

		// Alınabilecek kontrat adedi
		const quantity = riskAmount / riskPerCoin;

		// Nominal pozisyon büyüklüğü (USDT)
		const nominalSize = quantity * entryPrice;

		// Fiziksel nakit ve portföy limitleri
		const maxSize = Math.min(context.cash, context.equity / context.maxPositions);
		return Math.min(maxSize, nominalSize);
	}
}
