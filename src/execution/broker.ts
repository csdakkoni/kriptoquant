// ============================================================================
// KRIPTOQUANT — Broker Interface (Sprint 11)
// ============================================================================
// Broker'ın TEK görevi: emir almak ve Fill döndürmek.
// Slippage olabilir. Commission olabilir.
// Ama stop-loss, ATR, pozisyon, equity — bunlar Broker'ın işi DEĞİL.
//
// SimulatedBroker, PaperBroker, BinanceBroker hepsi bu interface'i implement eder.
// ============================================================================

// ─── Fill: Broker'ın döndürdüğü sonuç ───────────────────────────────────────

export interface Fill {
	readonly timestamp: number;
	readonly side: 'BUY' | 'SELL';
	readonly price: number;       // Gerçekleşen fiyat (slippage dahil)
	readonly quantity: number;    // BUY: alınan miktar. SELL: satılan miktar
	readonly commission: number;  // Kesilen komisyon (USDT)
}

// ─── Broker Interface ────────────────────────────────────────────────────────

export interface Broker {
	/**
	 * Piyasa alım emri.
	 * @param timestamp - Emir zamanı
	 * @param price - Referans fiyat (slippage uygulanmadan)
	 * @param usdtAmount - Harcanacak USDT miktarı (komisyon dahil)
	 * @returns Fill — Gerçekleşen alım
	 */
	buy(timestamp: number, price: number, usdtAmount: number): Fill;

	/**
	 * Piyasa satım emri.
	 * @param timestamp - Emir zamanı
	 * @param price - Referans fiyat (slippage uygulanmadan)
	 * @param quantity - Satılacak miktar (coin)
	 * @returns Fill — Gerçekleşen satım
	 */
	sell(timestamp: number, price: number, quantity: number): Fill;
}
