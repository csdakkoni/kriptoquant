// ============================================================================
// KRIPTOQUANT — Default Market Regime Classifier (Sprint 15)
// ============================================================================
// EMA200, ADX14 ve ATR14 indikatörlerini kullanarak 6 rejimli matrisi sınıflandırır.
// ============================================================================

import type { Candle } from '../../core/types.js';
import type { MarketRegime, RegimeClassifier, TrendRegime, VolatilityRegime } from './types.js';
import { adx, atr, ema } from '../../core/indicators/index.js';

function robustSma(values: number[], period: number): number[] {
	const result: number[] = new Array(values.length).fill(NaN);
	let firstValidIndex = 0;
	while (firstValidIndex < values.length && Number.isNaN(values[firstValidIndex])) {
		firstValidIndex++;
	}

	if (firstValidIndex + period > values.length) {
		return result;
	}

	let windowSum = 0;
	for (let i = firstValidIndex; i < firstValidIndex + period; i++) {
		windowSum += values[i];
	}
	result[firstValidIndex + period - 1] = windowSum / period;

	for (let i = firstValidIndex + period; i < values.length; i++) {
		windowSum += values[i] - values[i - period];
		result[i] = windowSum / period;
	}
	return result;
}

export class DefaultRegimeClassifier implements RegimeClassifier {
	classify(candles: Candle[]): MarketRegime[] {
		const result: MarketRegime[] = [];

		const closes = candles.map((c) => c.close);

		// 1) İndikatörleri hesapla (Küçük veri setlerinde çökmemek için dinamik periyot)
		const emaPeriod = candles.length >= 200 ? 200 : (candles.length >= 50 ? 50 : 0);
		const emaValues = emaPeriod > 0 ? ema(closes, emaPeriod) : new Array(candles.length).fill(NaN);
		
		// ADX en az 29 mum gerektirir (2 * 14 + 1)
		const adxResult = candles.length >= 29 ? adx(candles, 14) : { adx: new Array(candles.length).fill(NaN), plusDI: [], minusDI: [] };
		// ATR en az 15 mum gerektirir
		const atrValues = candles.length >= 15 ? atr(candles, 14) : new Array(candles.length).fill(NaN);

		// 2) Oynaklığı normalize et: Normalized ATR (NATR %)
		const natr: number[] = [];
		for (let i = 0; i < candles.length; i++) {
			const close = closes[i];
			const atrVal = atrValues[i];
			if (Number.isNaN(close) || Number.isNaN(atrVal) || close === 0) {
				natr.push(NaN);
			} else {
				natr.push((atrVal / close) * 100);
			}
		}

		// NATR'nin 50 periyotluk SMA'sı (NaN hassasiyetli)
		const sma50Natr = candles.length >= 50 ? robustSma(natr, 50) : new Array(candles.length).fill(NaN);

		// 3) Her mum için sınıflandırma yap
		for (let i = 0; i < candles.length; i++) {
			const close = closes[i];
			const emaVal = emaPeriod > 0 ? emaValues[i] : NaN;
			const adxVal = candles.length >= 14 ? adxResult.adx[i] : NaN;
			const natrVal = natr[i];
			const smaNatrVal = candles.length >= 50 ? sma50Natr[i] : NaN;

			// Yetersiz veri (warmup dönemi)
			if (
				Number.isNaN(emaVal) ||
				Number.isNaN(adxVal) ||
				Number.isNaN(natrVal) ||
				Number.isNaN(smaNatrVal)
			) {
				result.push({
					trend: 'SIDEWAYS',
					volatility: 'LOW',
				});
				continue;
			}

			// Trend Sınıflandırması
			let trend: TrendRegime = 'SIDEWAYS';
			if (adxVal > 20) {
				trend = close > emaVal ? 'BULL' : 'BEAR';
			}

			// Oynaklık Sınıflandırması
			const volatility: VolatilityRegime = natrVal > smaNatrVal ? 'HIGH' : 'LOW';

			result.push({ trend, volatility });
		}

		return result;
	}
}
