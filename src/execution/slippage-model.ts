// ============================================================================
// KRIPTOQUANT — Slippage & Transaction Cost Model (Sprint 34)
// ============================================================================

export interface CostAttribution {
	commissionUsdt: number;
	spreadUsdt: number;
	slippageUsdt: number;
	totalCostUsdt: number;
	executionPrice: number;
}

export class SlippageModel {
	private makerFeeRatio = 0.0004; // 0.04% maker commission fee
	private takerFeeRatio = 0.0010; // 0.10% taker commission fee
	private baseSpreadRatio = 0.0001; // 0.01% default bid-ask spread
	private eta = 0.5; // Kyle's Lambda square-root impact scaling factor
	private dailyVolumeUsdt = 250000000; // Simulated 250M USDT average daily volume depth

	/**
	 * Kyle's Lambda Square-Root market impact formülüyle işlem maliyetlerini ve slipajı hesaplar.
	 * 
	 * @param orderSize - Emir büyüklüğü (adet cinsinden)
	 * @param price - Güncel varlık fiyatı
	 * @param atrPercent - Varlığın ATR yüzde oranı (volatilite katsayısı, örn: 0.03)
	 * @param isTaker - Taker (market order) veya Maker (limit order) durum bayrağı
	 */
	public calculateTotalExecutionCost(
		orderSize: number,
		price: number,
		atrPercent: number,
		isTaker: boolean
	): CostAttribution {
		const tradeVolumeUsdt = orderSize * price;

		// 1) Commission Fee
		const feeRatio = isTaker ? this.takerFeeRatio : this.makerFeeRatio;
		const commissionUsdt = tradeVolumeUsdt * feeRatio;

		// 2) Bid-Ask Spread Cost (only for Taker orders crossing the spread)
		const spreadUsdt = isTaker ? (tradeVolumeUsdt * (this.baseSpreadRatio / 2)) : 0;

		// 3) Kyle's Lambda Slippage (Market Impact): slippage = eta * sigma * sqrt( Size / Volume_24h )
		const relativeSize = tradeVolumeUsdt / this.dailyVolumeUsdt;
		const slippageRatio = this.eta * atrPercent * Math.sqrt(relativeSize);
		const slippageUsdt = tradeVolumeUsdt * slippageRatio;

		const totalCostUsdt = commissionUsdt + spreadUsdt + slippageUsdt;
		
		// Slippage price direction shifts (slippage increases buy execution price, decreases sell execution price)
		const executionPrice = isTaker ? (price + (price * slippageRatio)) : price;

		return {
			commissionUsdt: parseFloat(commissionUsdt.toFixed(4)),
			spreadUsdt: parseFloat(spreadUsdt.toFixed(4)),
			slippageUsdt: parseFloat(slippageUsdt.toFixed(4)),
			totalCostUsdt: parseFloat(totalCostUsdt.toFixed(4)),
			executionPrice: parseFloat(executionPrice.toFixed(4))
		};
	}
}
