// ============================================================================
// KRIPTOQUANT — Feature Store (Sprint 31)
// ============================================================================

import { adx, atr, ema, rsi } from '../core/indicators/index.js';
import type { Candle } from '../core/types.js';

export interface FeatureVector {
	timestamp: number;
	features: {
		emaSlope: number;
		adxVal: number;
		atrPercentile: number;
		rsiVal: number;
		volumeSpike: number;
	};
	targetY: number; // 1 if next price return > 0, else 0
}

export interface FeatureMetadata {
	name: string;
	type: 'NUMERIC' | 'CATEGORICAL';
	version: string;
	source: string;
	normalization: 'NONE' | 'Z_SCORE' | 'MIN_MAX' | 'PERCENTILE';
	missingPolicy: 'ZERO_FILL' | 'FORWARD_FILL' | 'MEAN_IMPUTE';
}

export class FeatureStore {
	/**
	 * Feature Store özellikleri için veri şeması ve metadata tanımlarını döner.
	 */
	public getFeatureMetadataCatalog(): FeatureMetadata[] {
		return [
			{ name: 'emaSlope', type: 'NUMERIC', version: '1.0.0', source: 'EMA_20_SLOPE', normalization: 'Z_SCORE', missingPolicy: 'ZERO_FILL' },
			{ name: 'adxVal', type: 'NUMERIC', version: '1.0.0', source: 'ADX_14', normalization: 'NONE', missingPolicy: 'FORWARD_FILL' },
			{ name: 'atrPercentile', type: 'NUMERIC', version: '1.0.0', source: 'ATR_14_PERCENTILE', normalization: 'PERCENTILE', missingPolicy: 'FORWARD_FILL' },
			{ name: 'rsiVal', type: 'NUMERIC', version: '1.0.0', source: 'RSI_14', normalization: 'NONE', missingPolicy: 'MEAN_IMPUTE' },
			{ name: 'volumeSpike', type: 'NUMERIC', version: '1.0.0', source: 'VOLUME_RATIO_1.5X', normalization: 'NONE', missingPolicy: 'ZERO_FILL' }
		];
	}

	/**
	 * Mum verilerini analiz ederek tabular özellik vektörleri matrisi (Feature Store) oluşturur.
	 */
	public buildFeatureMatrix(candles: Candle[]): FeatureVector[] {
		const n = candles.length;
		if (n < 50) return [];

		const matrix: FeatureVector[] = [];

		// Compute indicators on the entire dataset
		const closes = candles.map(c => c.close);
		const ema20 = ema(closes, 20);
		
		const adxRes = adx(candles, 14);
		const adxValues = adxRes.adx;

		const atrValues = atr(candles, 14);
		
		const rsiValues = rsi(closes, 14);

		// Calculate average volume for volumeSpike detection
		const volumes = candles.map(c => c.volume);
		const avgVolume = volumes.reduce((a, b) => a + b, 0) / n;

		// Calculate features for index 30 to n - 3 (3-period horizon target lookup)
		for (let i = 30; i < n - 3; i++) {
			const emaSlope = (ema20[i] - ema20[i - 1]) / (ema20[i - 1] || 1);
			const adxVal = adxValues[i] || 20;
			
			// ATR percentile over trailing 30 candles
			const trailingAtrs = atrValues.slice(i - 30, i + 1).filter(v => !isNaN(v));
			let atrPercentile = 0.5;
			if (trailingAtrs.length > 0) {
				const smaller = trailingAtrs.filter(v => v < atrValues[i]).length;
				atrPercentile = smaller / trailingAtrs.length;
			}

			const rsiVal = rsiValues[i] || 50;
			const volumeSpike = volumes[i] > (avgVolume * 1.5) ? 1 : 0;

			// Target Y: next 3 candles return > 0 (1-day horizon equivalent)
			const nextReturn = (candles[i + 3].close - candles[i].close) / candles[i].close;
			const targetY = nextReturn > 0 ? 1 : 0;

			matrix.push({
				timestamp: candles[i].openTime,
				features: {
					emaSlope: parseFloat(emaSlope.toFixed(6)),
					adxVal: parseFloat(adxVal.toFixed(2)),
					atrPercentile: parseFloat(atrPercentile.toFixed(2)),
					rsiVal: parseFloat(rsiVal.toFixed(2)),
					volumeSpike
				},
				targetY
			});
		}

		return matrix;
	}
}
