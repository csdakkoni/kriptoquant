// ============================================================================
// KRIPTOQUANT — Bollinger Bands + RSI Divergence Stratejisi
// ============================================================================
// Strateji Kuralları:
// 1. Son 40 mum taranarak en son 2 belirgin yerel fiyat dip noktası bulunur.
// 2. Fiyatın daha düşük dip yapmasına rağmen, RSI'ın daha yüksek dip yapması
//    durumu (Boğa Uyumsuzluğu - Bullish Divergence) kontrol edilir.
// 3. Giriş: Fiyat alt Bollinger Bandının altındayken (Price <= Lower Band)
//    ve son 3 mumda onaylanmış bir Boğa Uyumsuzluğu varsa LONG girilir.
// 4. Çıkış: Fiyat üst Bollinger Bandına ulaştığında (Price >= Upper Band).
// 5. Zarar Kes: Giriş anındaki oynaklığa göre ATR tabanlı stop (Entry - 2 * ATR).
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { bollingerBands, rsi, atr } from '../../../core/indicators/index.js';

interface LocalMinimum {
	priceIdx: number;
	price: number;
	rsi: number;
}

/**
 * Fiyat ve RSI serilerindeki yerel dip noktalarını (valleys) tespit eder.
 */
function findLocalMinima(prices: number[], rsiValues: number[], startIdx: number, endIdx: number): LocalMinimum[] {
	const minima: LocalMinimum[] = [];
	for (let j = startIdx; j <= endIdx; j++) {
		if (j <= 0 || j >= prices.length - 1) continue;

		// Bir noktanın yerel dip olması için sağındaki ve solundaki değerlerden küçük olması gerekir.
		if (prices[j] < prices[j - 1] && prices[j] < prices[j + 1]) {
			minima.push({
				priceIdx: j,
				price: prices[j],
				rsi: rsiValues[j]
			});
		}
	}
	return minima;
}

export function createBollingerRsiDivStrategy(
	bbPeriod: number = 20,
	bbMultiplier: number = 2,
	rsiPeriod: number = 14,
	atrPeriod: number = 14
): Strategy {
	return {
		name: 'bollinger-rsi-div',
		description: 'Bollinger + RSI Divergence (Uyumsuzluk Filtreli)',
		warmupPeriod: 50,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			const warmup = 50;
			if (candles.length < warmup) return [];

			const closes = candles.map(c => c.close);
			const bb = bollingerBands(closes, bbPeriod, bbMultiplier);
			const rsiValues = rsi(closes, rsiPeriod);
			const atrValues = atr(candles, atrPeriod);

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = warmup; i < candles.length; i++) {
				const current = candles[i];
				const lowerBand = bb.lower[i];
				const upperBand = bb.upper[i];
				const atrVal = atrValues[i];

				if (Number.isNaN(lowerBand) || Number.isNaN(upperBand) || Number.isNaN(atrVal)) {
					continue;
				}

				// Son 40 mum içindeki yerel dipleri ara
				const startIdx = Math.max(1, i - 40);
				const endIdx = i - 1; // Cari mum henüz kapanmadığı için dahil edilmez
				const minima = findLocalMinima(closes, rsiValues, startIdx, endIdx);

				let hasBullishDivergence = false;
				let debugDivergenceInfo = '';

				if (minima.length >= 2) {
					// En son iki belirgin dip noktasını al
					const idx1 = minima[minima.length - 1]; // En son dip
					const idx2 = minima[minima.length - 2]; // Ondan önceki dip

					// İki dip noktası arasında en az 5 mum mesafe olması istenir (gürültüyü engellemek için)
					const distance = idx1.priceIdx - idx2.priceIdx;
					const isRecentMinima = (i - idx1.priceIdx) <= 3; // En son dip çok eski olmamalı (maks. 3 mum önce)

					if (distance >= 5 && isRecentMinima) {
						const priceMakesLowerLow = idx1.price < idx2.price;
						const rsiMakesHigherLow = idx1.rsi > idx2.rsi;
						const isOversoldContext = idx2.rsi < 40 && idx1.rsi < 45;

						if (priceMakesLowerLow && rsiMakesHigherLow && isOversoldContext) {
							hasBullishDivergence = true;
							debugDivergenceInfo = `Price: ${idx1.price.toFixed(2)} < ${idx2.price.toFixed(2)} | RSI: ${idx1.rsi.toFixed(1)} > ${idx2.rsi.toFixed(1)}`;
						}
					}
				}

				const isBuySetup = current.close <= lowerBand && hasBullishDivergence;
				const isSellSetup = current.close >= upperBand;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					const slPrice = current.close - 2 * atrVal;
					const tpPrice = upperBand;

					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.95,
						reason: `Bollinger + RSI Div BUY: Price <= Lower Band (${current.close.toFixed(2)} <= ${lowerBand.toFixed(2)}) & Bullish Divergence Confirmed (${debugDivergenceInfo}). SL: ${slPrice.toFixed(2)}, TP: ${tpPrice.toFixed(2)}`,
						metadata: {
							sl: slPrice,
							tp: tpPrice,
							atr: atrVal
						}
					});
					lastSignalSide = 'BUY';
				} else if (isSellSetup && lastSignalSide === 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'SELL',
						price: current.close,
						confidence: 0.95,
						reason: `Bollinger + RSI Div SELL (BB Upper reached): Price >= Upper Band (${current.close.toFixed(2)} >= ${upperBand.toFixed(2)}).`
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
