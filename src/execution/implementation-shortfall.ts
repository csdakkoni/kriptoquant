// ============================================================================
// KRIPTOQUANT — Implementation Shortfall (IS) Analyzer (Sprint 35)
// ============================================================================

export interface ShortfallAnalysis {
	decisionPrice: number;
	arrivalPrice: number;
	executionPrice: number;
	quantity: number;
	side: 'BUY' | 'SELL';
	slippageUsdt: number;
	commissionUsdt: number;
	implementationShortfallUsdt: number;
	implementationShortfallBps: number; // in basis points
}

export class ImplementationShortfallAnalyzer {
	/**
	 * Karar anından dolum anına kadarki maliyet ve slipaj kayıplarını (Implementation Shortfall) hesaplar.
	 * 
	 * @param decisionPrice - Stratejinin emre karar verdiği fiyat (P_decision)
	 * @param arrivalPrice - Emrin borsaya ulaştığı an (gecikmeli) fiyatı (P_arrival)
	 * @param executionPrice - Ortalama gerçekleşen fiyat (P_execution)
	 * @param quantity - Varlık miktarı (size)
	 * @param side - BUY veya SELL yönü
	 * @param commissionUsdt - Ödenen komisyon tutarı
	 */
	public analyzeShortfall(
		decisionPrice: number,
		arrivalPrice: number,
		executionPrice: number,
		quantity: number,
		side: 'BUY' | 'SELL',
		commissionUsdt: number
	): ShortfallAnalysis {
		const sideSign = side === 'BUY' ? 1 : -1;

		// 1) Slippage Cost (Arrival Price vs Execution Price)
		const slippageUsdt = sideSign * (executionPrice - arrivalPrice) * quantity;

		// 2) Implementation Shortfall Cost: side * (executionPrice - decisionPrice) * quantity + commission
		const executionUsdt = quantity * executionPrice;
		const decisionUsdt = quantity * decisionPrice;
		const implementationShortfallUsdt = (sideSign * (executionPrice - decisionPrice) * quantity) + commissionUsdt;

		// Relative cost in basis points (1 bps = 0.01% of decision value)
		const implementationShortfallBps = decisionUsdt > 0 
			? (implementationShortfallUsdt / decisionUsdt) * 10000 
			: 0;

		return {
			decisionPrice: parseFloat(decisionPrice.toFixed(4)),
			arrivalPrice: parseFloat(arrivalPrice.toFixed(4)),
			executionPrice: parseFloat(executionPrice.toFixed(4)),
			quantity,
			side,
			slippageUsdt: parseFloat(Math.max(0, slippageUsdt).toFixed(4)),
			commissionUsdt: parseFloat(commissionUsdt.toFixed(4)),
			implementationShortfallUsdt: parseFloat(implementationShortfallUsdt.toFixed(4)),
			implementationShortfallBps: parseFloat(implementationShortfallBps.toFixed(2))
		};
	}
}
