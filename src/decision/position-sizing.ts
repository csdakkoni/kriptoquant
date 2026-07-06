// ============================================================================
// KRIPTOQUANT — Position Sizing Engine (Sprint 29)
// ============================================================================

export interface SizeResult {
	quantity: number;
	stopLossPrice: number;
	takeProfitPrice: number;
	riskAmountUsdt: number;
}

export class PositionSizingEngine {
	/**
	 * Risk yüzdesi ve ATR mesafesine göre kontrat/hisse adedini (Fixed Fractional) hesaplar.
	 * 
	 * @param equity - Toplam hesap büyüklüğü (Portföy Değeri)
	 * @param riskPercentage - İşlem başına göze alınan risk %'si (örn: %1)
	 * @param entryPrice - İşleme giriş fiyatı
	 * @param atr - Güncel ATR volatilite değeri
	 * @param atrMultiplier - Stop Loss mesafesi çarpanı (örn: 2.0 * ATR)
	 */
	public calculateATRSize(
		equity: number,
		riskPercentage: number,
		entryPrice: number,
		atr: number,
		atrMultiplier: number = 2.0
	): SizeResult {
		if (equity <= 0 || entryPrice <= 0 || atr <= 0) {
			return { quantity: 0, stopLossPrice: 0, takeProfitPrice: 0, riskAmountUsdt: 0 };
		}

		// Riske edilecek maksimum bakiye (örn: 10,000 * %1 = 100 USDT)
		const riskAmountUsdt = equity * (riskPercentage / 100);

		// Stop Loss mesafesi (örn: 2 * ATR)
		const stopDistance = atr * atrMultiplier;

		// Kontrat miktarı = Riske edilecek tutar / SL mesafesi
		let quantity = riskAmountUsdt / stopDistance;

		// Minimum kontrat adeti koruması
		if (quantity <= 0) quantity = 0;

		const stopLossPrice = entryPrice - stopDistance;
		const takeProfitPrice = entryPrice + (stopDistance * 2.5); // 2.5 R-Multiple Target

		return {
			quantity: parseFloat(quantity.toFixed(4)),
			stopLossPrice: parseFloat(stopLossPrice.toFixed(4)),
			takeProfitPrice: parseFloat(takeProfitPrice.toFixed(4)),
			riskAmountUsdt
		};
	}

	/**
	 * Stratejinin beklentisine (Expectancy) göre Kelly tahsis oranını hesaplar.
	 */
	public calculateKellySize(
		equity: number,
		winRate: number,
		averageR: number,
		entryPrice: number
	): number {
		if (equity <= 0 || entryPrice <= 0 || averageR <= 0) return 0;

		// Kelly Formülü: f = w - (1 - w) / R
		const w = winRate;
		const r = averageR;

		const kellyFraction = w - (1 - w) / r;
		
		// Risk koruması için Half-Kelly (%50) kullanılır ve %15 ile sınırlandırılır
		let halfKelly = kellyFraction * 0.5;
		if (halfKelly < 0) halfKelly = 0;
		if (halfKelly > 0.15) halfKelly = 0.15;

		const budget = equity * halfKelly;
		return parseFloat((budget / entryPrice).toFixed(4));
	}
}
