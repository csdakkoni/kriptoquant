// ============================================================================
// KRIPTOQUANT — Bollinger Bands Timestamp (Saat Filtreli)
// ============================================================================
// Strateji Kuralları:
// 1. Giriş: Fiyat alt Bollinger Bandının altına sarktığında (Price <= Lower Band).
// 2. Çıkış: Fiyat üst Bollinger Bandına ulaştığında (Price >= Upper Band).
// 3. Saat Filtresi: 11:00 UTC - 14:59 UTC arasında sinyal üretilmesi ENGELLENİR.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { bollingerBands } from '../../../core/indicators/index.js';

export function createBollingerBandsTimestampStrategy(
	bbPeriod: number = 20,
	bbMultiplier: number = 2
): Strategy {
	return {
		name: 'bollinger-bands-timestamp',
		description: 'Bollinger Bands (Saat Filtreli - Asya/US Seans Odaklı)',
		warmupPeriod: 20,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 20) return [];

			const closes = candles.map(c => c.close);
			const bb = bollingerBands(closes, bbPeriod, bbMultiplier);

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = 20; i < candles.length; i++) {
				const current = candles[i];
				const lowerBand = bb.lower[i];
				const upperBand = bb.upper[i];

				if (Number.isNaN(lowerBand) || Number.isNaN(upperBand)) {
					continue;
				}

				// UTC saatini bulma
				const date = new Date(current.openTime);
				const utcHour = date.getUTCHours();

				// 11:00 - 14:59 UTC arasını engelleme (Avrupa açılışı / volatilite saati)
				const isBlockedHour = utcHour >= 11 && utcHour <= 14;

				const isBuySetup = current.close <= lowerBand && !isBlockedHour;
				const isSellSetup = current.close >= upperBand; // Çıkış her zaman aktif kalabilir

				if (isBuySetup && lastSignalSide !== 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.75,
						reason: `BB Timestamp BUY: Price <= Lower Band (${current.close.toFixed(4)} <= ${lowerBand.toFixed(4)}) & Hour = ${utcHour} UTC (Allowed).`,
					});
					lastSignalSide = 'BUY';
				} else if (isSellSetup && lastSignalSide === 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'SELL',
						price: current.close,
						confidence: 0.75,
						reason: `BB Timestamp SELL: Price >= Upper Band (${current.close.toFixed(4)} >= ${upperBand.toFixed(4)}) & Hour = ${utcHour} UTC.`,
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
