// ============================================================================
// KRIPTOQUANT — Portfolio Engine Types (Sprint 18)
// ============================================================================

import type { Candle } from '../../core/types.js';

export interface AlignedTimelineStep {
	readonly timestamp: number;
	readonly candles: Map<string, Candle>;
}

export interface AllocationContext {
	readonly cash: number;
	readonly equity: number;
	readonly openPositionsCount: number;
	readonly maxPositions: number;
}

export interface AllocationStrategy {
	/**
	 * Bir işlem için ayrılacak sermaye büyüklüğünü (USDT) hesaplar.
	 *
	 * @param coin - Varlık sembolü (ör. "BTCUSDT")
	 * @param entryPrice - Giriş fiyatı (USDT)
	 * @param atr - ATR değeri (stop-loss bütçesi için)
	 * @param context - Bakiye ve açık pozisyon durumları
	 */
	allocate(coin: string, entryPrice: number, atr: number, context: AllocationContext): number;
}

export interface PortfolioConstraints {
	readonly maxPositions: number;
	readonly preventDoublePosition: boolean;
	readonly ruinThresholdPercent?: number;
}
