// ============================================================================
// KRIPTOQUANT — Signal Filter Engine
// ============================================================================
// Stratejiden bağımsız filtre katmanı. Config-driven — eşikler kodda değil.
// Pipeline: Strategy → [Filter Engine] → Confidence Engine → Risk → Execution
// Yeni filtre eklemek = bu dosyaya bir if bloğu eklemek. Strateji dokunulmaz.
// ============================================================================

import type { Candle, FilterConfig } from '../../core/types.js';
import { adx } from '../../core/indicators/index.js';
import { sma } from '../../core/indicators/index.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface FilterVerdict {
	readonly passed: boolean;
	readonly reasons: string[];
	readonly adx: number;
	readonly rvol: number;
}

export interface FilterEngine {
	evaluate(candleIndex: number): FilterVerdict;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Verilen mum dizisi ve config için Filter Engine oluşturur.
 * Tüm indikatörler bir kez hesaplanır, sonra her sinyal için O(1) lookup.
 */
export function createFilterEngine(candles: Candle[], config: FilterConfig): FilterEngine {
	const { adxPeriod, adxVetoThreshold, rvolLookback, rvolVetoThreshold } = config;

	// ── Ön hesaplamalar (bir kez) ────────────────────────────────────────
	const adxResult = candles.length >= 2 * adxPeriod + 1
		? adx(candles, adxPeriod)
		: null;

	const volumes = candles.map((c) => c.volume);
	const volMa = volumes.length >= rvolLookback
		? sma(volumes, rvolLookback)
		: new Array(volumes.length).fill(NaN);

	const rvolValues = volumes.map((v, i) =>
		!Number.isNaN(volMa[i]) && volMa[i] > 0 ? v / volMa[i] : NaN,
	);

	return {
		evaluate(candleIndex: number): FilterVerdict {
			const currentAdx = adxResult && candleIndex < adxResult.adx.length
				? adxResult.adx[candleIndex]
				: NaN;

			const currentRvol = candleIndex < rvolValues.length
				? rvolValues[candleIndex]
				: NaN;

			const reasons: string[] = [];

			// 1. ADX Trend Gücü Filtresi
			if (Number.isNaN(currentAdx) || currentAdx < adxVetoThreshold) {
				reasons.push(
					`Weak Trend (ADX: ${Number.isNaN(currentAdx) ? 'N/A' : currentAdx.toFixed(1)})`,
				);
			}

			// 2. Göreceli Hacim Filtresi
			if (Number.isNaN(currentRvol) || currentRvol < rvolVetoThreshold) {
				reasons.push(
					`Low Volume (RVOL: ${Number.isNaN(currentRvol) ? 'N/A' : currentRvol.toFixed(2)})`,
				);
			}

			return {
				passed: reasons.length === 0,
				reasons,
				adx: Number.isNaN(currentAdx) ? 0 : currentAdx,
				rvol: Number.isNaN(currentRvol) ? 0 : currentRvol,
			};
		},
	};
}
