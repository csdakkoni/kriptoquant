// ============================================================================
// KRIPTOQUANT — Stop Loss Rules (Sprint 12)
// ============================================================================
// Stop-loss kurallarını soyutlayan arayüz ve implementasyonlar.
// ============================================================================

import type { Candle } from '../core/types.js';

export interface PositionInfo {
	readonly entryPrice: number;
	readonly quantity: number;
	readonly stopLossPrice: number;
	readonly atrAtEntry: number;
	readonly entryTimestamp: number;
}

export interface StopSignal {
	readonly exitPrice: number;
	readonly reason: string;
}

export interface StopRule {
	/**
	 * Mum hareketine göre stop-loss kontrolü yapar.
	 *
	 * @param position - Mevcut pozisyon bilgileri
	 * @param candle - İncelenen mum
	 * @returns Tetiklenme olursa StopSignal, yoksa null
	 */
	evaluate(position: PositionInfo, candle: Candle): StopSignal | null;
}

// ─── ATR Stop Rule ──────────────────────────────────────────────────────────

export class AtrStopRule implements StopRule {
	private readonly atrMultiplier: number;

	constructor(atrMultiplier: number) {
		this.atrMultiplier = atrMultiplier;
	}

	evaluate(position: PositionInfo, candle: Candle): StopSignal | null {
		if (position.stopLossPrice <= 0) return null;

		if (candle.low <= position.stopLossPrice) {
			if (candle.open <= position.stopLossPrice) {
				// Gap-down: Açılış fiyatından çıkış
				return {
					exitPrice: candle.open,
					reason: `Stop-Loss Gap-Down (open=${candle.open.toFixed(2)} < stop=${position.stopLossPrice.toFixed(2)})`,
				};
			} else {
				// Normal stop tetiklenmesi
				return {
					exitPrice: position.stopLossPrice,
					reason: `Stop-Loss (ATR×${this.atrMultiplier})`,
				};
			}
		}

		return null;
	}
}
