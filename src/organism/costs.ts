// ============================================================================
// ORGANISM — Gerçekçi İşlem Maliyetleri
// ============================================================================
// Paper trade sonuçlarının canlıda da geçerli olması için bir işlemin gerçek
// hayattaki TÜM maliyetleri düşülür:
//
//   1. Komisyon  — Binance USDT-M Futures taker ücreti, her yön için %0.05.
//                  Botun tüm emirleri (giriş, stop, hedef, çıkış) market emridir.
//   2. Kayma     — Market emri ekrandaki fiyattan değil, emir defterindeki bir
//                  sonraki fiyattan dolar. Stop emirleri hareketli anlarda
//                  tetiklendiği için kayma daha da büyür. Her yön için %0.05.
//   3. Funding   — Futures pozisyonu tutulduğu sürece her 8 saatte (bazı
//                  coinlerde 4 saatte) bir ödenen/alınan ücret. Borsanın
//                  gerçek geçmiş oranlarından hesaplanır (funding.ts).
//
// Değerler .env üzerinden değiştirilebilir (PAPER_TAKER_FEE_PCT, PAPER_SLIPPAGE_PCT).
// ============================================================================

/** Yön başına taker komisyonu (%) */
export const TAKER_FEE_PCT = Number(process.env.PAPER_TAKER_FEE_PCT) || 0.05;

/** Yön başına tahmini kayma (%) */
export const SLIPPAGE_PCT = Number(process.env.PAPER_SLIPPAGE_PCT) || 0.05;

/** Paper işlem için gidiş-dönüş komisyon + kayma maliyeti (%) — varsayılan %0.20 */
export function paperRoundTripCostPct(): number {
	return 2 * (TAKER_FEE_PCT + SLIPPAGE_PCT);
}

/**
 * Bir pozisyonun gidiş-dönüş komisyon+kayma maliyeti (%).
 * Canlı pozisyonda gerçek komisyon oranı biliniyorsa o kullanılır; kayma zaten
 * gerçek dolum fiyatının içindedir, tekrar düşülmez.
 */
export function roundTripCostPct(pos: { isLive?: boolean; entryFeeRate?: number }): number {
	if (pos.isLive && pos.entryFeeRate) return pos.entryFeeRate * 2;
	return paperRoundTripCostPct();
}
