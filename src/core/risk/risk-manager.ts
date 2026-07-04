// ============================================================================
// KRIPTOQUANT — Risk Manager
// ============================================================================
// Risk kurallarını uygular. Veto yetkisine sahiptir.
// Hem Research (backtest) hem Live ortamda aynı kurallar çalışır.
// ============================================================================

import type { RiskConfig, Signal } from '../types.js';

/**
 * Risk değerlendirmesi sonucu.
 */
export interface RiskDecision {
	readonly approved: boolean;
	readonly reason: string;
	readonly positionSize: number; // Onaylanan emir büyüklüğü (USDT)
}

/**
 * Bir sinyali risk kurallarından geçirir.
 *
 * Risk katmanı veto yetkisine sahiptir. Strateji "AL" dese bile,
 * bu fonksiyon limitleri aşıldığında sinyali reddeder.
 *
 * @param signal - Stratejinin ürettiği sinyal
 * @param currentCapital - Mevcut portföy değeri (USDT)
 * @param dailyPnl - Bugünkü toplam kar/zarar (USDT)
 * @param config - Risk konfigürasyonu
 * @returns Onay/ret kararı ve gerekçesi
 */
export function evaluateRisk(
	signal: Signal,
	currentCapital: number,
	dailyPnl: number,
	config: RiskConfig,
): RiskDecision {
	// Kural 1: Günlük kayıp limiti kontrolü
	const dailyLossLimit = currentCapital * (config.maxDailyLossPercent / 100);
	if (dailyPnl < 0 && Math.abs(dailyPnl) >= dailyLossLimit) {
		return {
			approved: false,
			reason: `Günlük kayıp limiti aşıldı: ${Math.abs(dailyPnl).toFixed(2)} USDT >= ${dailyLossLimit.toFixed(2)} USDT limit`,
			positionSize: 0,
		};
	}

	// Kural 2: Pozisyon büyüklüğü hesapla
	const maxPositionValue = currentCapital * (config.maxPositionPercent / 100);
	const positionSize = Math.min(maxPositionValue, config.maxOrderValue);

	// Kural 3: Emir büyüklüğü minimum kontrol
	if (positionSize < 10) {
		return {
			approved: false,
			reason: `Hesaplanan pozisyon büyüklüğü çok küçük: ${positionSize.toFixed(2)} USDT < 10 USDT minimum`,
			positionSize: 0,
		};
	}

	return {
		approved: true,
		reason: `${signal.side} sinyali onaylandı. Pozisyon: ${positionSize.toFixed(2)} USDT`,
		positionSize,
	};
}
