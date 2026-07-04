// ============================================================================
// KRIPTOQUANT — Average Directional Index (ADX)
// ============================================================================
// Welles Wilder'ın trend gücü ölçüsü.
// ADX < 20 → yatay/trendless piyasa, ADX > 25 → güçlü trend.
// trueRange() fonksiyonu atr.ts'den import edilir (DRY).
// ============================================================================

import type { Candle } from '../types.js';
import { trueRange } from './atr.js';

/**
 * ADX hesaplama sonucu.
 */
export interface ADXResult {
	readonly adx: number[];
	readonly plusDI: number[];
	readonly minusDI: number[];
}

/**
 * Wilder's smoothing uygular (ATR, +DM, -DM için ortak).
 * İlk değer: ilk `period` adet geçerli değerin basit ortalaması.
 * Sonrakiler: (prev × (period-1) + current) / period
 *
 * @param values - Ham değerler (indeks 0 = NaN beklenir)
 * @param period - Smoothing periyodu
 * @returns Smoothed değerler
 */
function wilderSmooth(values: number[], period: number): number[] {
	const result: number[] = new Array(values.length).fill(NaN);

	// İlk `period` geçerli değerin ortalaması (values[1..period])
	let sum = 0;
	for (let i = 1; i <= period; i++) {
		sum += values[i];
	}
	result[period] = sum / period;

	// Wilder's smoothing
	for (let i = period + 1; i < values.length; i++) {
		result[i] = (result[i - 1] * (period - 1) + values[i]) / period;
	}

	return result;
}

/**
 * Average Directional Index (ADX) hesaplar.
 *
 * Adımlar:
 * 1. True Range, +DM, -DM hesapla
 * 2. Wilder smoothing ile +DM14, -DM14, TR14 elde et
 * 3. +DI = 100 × smoothed(+DM) / smoothed(TR)
 * 4. -DI = 100 × smoothed(-DM) / smoothed(TR)
 * 5. DX = 100 × |+DI - -DI| / (+DI + -DI)
 * 6. ADX = Wilder smoothed DX
 *
 * İlk geçerli ADX: indeks 2×period (yaklaşık 28 mum sonra)
 *
 * @param candles - Mum verileri
 * @param period - ADX periyodu (standart: 14)
 */
export function adx(candles: Candle[], period: number = 14): ADXResult {
	if (period <= 0) throw new Error(`ADX period must be positive, got ${period}`);
	const minCandles = 2 * period + 1;
	if (candles.length < minCandles) {
		throw new Error(`ADX needs at least ${minCandles} candles, got ${candles.length}`);
	}

	const n = candles.length;

	// ── 1. True Range, +DM, -DM hesapla ──────────────────────────────────
	const tr = trueRange(candles);

	const plusDM: number[] = new Array(n);
	const minusDM: number[] = new Array(n);
	plusDM[0] = NaN;
	minusDM[0] = NaN;

	for (let i = 1; i < n; i++) {
		const upMove = candles[i].high - candles[i - 1].high;
		const downMove = candles[i - 1].low - candles[i].low;

		plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
		minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
	}

	// ── 2. Wilder smoothing ──────────────────────────────────────────────
	const smoothedTR = wilderSmooth(tr, period);
	const smoothedPlusDM = wilderSmooth(plusDM, period);
	const smoothedMinusDM = wilderSmooth(minusDM, period);

	// ── 3-4. +DI, -DI hesapla ────────────────────────────────────────────
	const plusDIArr: number[] = new Array(n).fill(NaN);
	const minusDIArr: number[] = new Array(n).fill(NaN);
	const dx: number[] = new Array(n).fill(NaN);

	for (let i = period; i < n; i++) {
		if (Number.isNaN(smoothedTR[i]) || smoothedTR[i] === 0) continue;

		plusDIArr[i] = 100 * smoothedPlusDM[i] / smoothedTR[i];
		minusDIArr[i] = 100 * smoothedMinusDM[i] / smoothedTR[i];

		// ── 5. DX hesapla ────────────────────────────────────────────────
		const diSum = plusDIArr[i] + minusDIArr[i];
		dx[i] = diSum > 0 ? 100 * Math.abs(plusDIArr[i] - minusDIArr[i]) / diSum : 0;
	}

	// ── 6. ADX = Wilder smoothed DX ──────────────────────────────────────
	// İlk ADX = ilk `period` geçerli DX'in ortalaması
	const adxArr: number[] = new Array(n).fill(NaN);

	const firstDXIndex = period; // İlk geçerli DX
	const adxStartIndex = firstDXIndex + period; // İlk ADX

	if (adxStartIndex < n) {
		let dxSum = 0;
		for (let i = firstDXIndex; i < adxStartIndex; i++) {
			dxSum += Number.isNaN(dx[i]) ? 0 : dx[i];
		}
		adxArr[adxStartIndex] = dxSum / period;

		// Wilder's smoothing for ADX
		for (let i = adxStartIndex + 1; i < n; i++) {
			const currentDX = Number.isNaN(dx[i]) ? 0 : dx[i];
			adxArr[i] = (adxArr[i - 1] * (period - 1) + currentDX) / period;
		}
	}

	return {
		adx: adxArr,
		plusDI: plusDIArr,
		minusDI: minusDIArr,
	};
}
