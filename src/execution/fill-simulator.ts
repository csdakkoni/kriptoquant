// ============================================================================
// KRIPTOQUANT — Latency & Queue Fill Simulator (Sprint 34)
// ============================================================================

import type { Candle } from '../core/types.js';

export interface FillSimulationResult {
	originalPrice: number;
	simulatedFillPrice: number;
	fillLatencyMs: number;
	fillRatio: number; // 0.0 - 1.0 (simulated partial fill)
	slippageUsdt: number;
}

export class FillSimulator {
	/**
	 * Ağ gecikmesi ve order book öncelik kuyruğunu simüle ederek dolum fiyatı ve oranını hesaplar.
	 * 
	 * @param price - Birincil stratejiden gelen ham tetiklenme fiyatı
	 * @param candle - Tetiklenmenin yaşandığı güncel mum verisi
	 * @param latencyMs - Milisaniye cinsinden ağ gecikmesi (örn: 150ms)
	 * @param sizeUsdt - Emir büyüklüğü (USDT)
	 */
	public simulateOrderFill(
		price: number,
		candle: Candle,
		latencyMs: number = 150,
		sizeUsdt: number = 10000
	): FillSimulationResult {
		// 1) Simulated Latency Price drift based on sub-minute candle range volatility
		const candleRange = candle.high - candle.low;
		const latencyRatio = Math.min(1.0, latencyMs / 60000); // 1-minute candle fraction
		const priceDrift = (Math.random() - 0.4) * candleRange * latencyRatio;
		const simulatedFillPrice = price + priceDrift;

		// 2) Queue-based Partial Fill Simulation
		// Large orders in thin market conditions (high volatility) experience partial fills
		let fillRatio = 1.0;
		if (sizeUsdt > 50000 && candleRange > (price * 0.02)) {
			// Big order during high volatility gets a partial fill (e.g. 70% - 95%)
			fillRatio = parseFloat((0.70 + Math.random() * 0.25).toFixed(2));
		}

		const slippageUsdt = Math.abs(simulatedFillPrice - price) * (sizeUsdt / price);

		return {
			originalPrice: price,
			simulatedFillPrice: parseFloat(simulatedFillPrice.toFixed(4)),
			fillLatencyMs: latencyMs,
			fillRatio,
			slippageUsdt: parseFloat(slippageUsdt.toFixed(4))
		};
	}
}
