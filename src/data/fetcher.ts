// ============================================================================
// KRIPTOQUANT — Data Fetcher (Orchestrator)
// ============================================================================
// Veri çekme işlemini orkestre eder: API'den çek → dosyaya kaydet.
// Mevcut veri varsa tekrar çekmez (cache mantığı).
// ============================================================================

import { getCandles } from './binance-client.js';
import { hasData, loadCandles, saveCandles } from './store.js';
import type { Candle } from '../core/types.js';
import { log } from '../core/utils.js';

/**
 * Belirtilen coin için veri çeker ve kaydeder.
 * Eğer veri zaten mevcutsa, tekrar çekmez (force=true ile zorlanabilir).
 *
 * @param symbol - Coin sembolü (ör. "BTCUSDT")
 * @param interval - Mum aralığı (ör. "1d")
 * @param options - Opsiyonel: startTime, endTime, force
 * @returns Mum verileri
 */
export async function fetchAndStore(
	symbol: string,
	interval: string,
	options: {
		startTime?: number;
		endTime?: number;
		force?: boolean;
	} = {},
): Promise<Candle[]> {
	const { startTime, endTime, force = false } = options;

	// Eğer cache zorlanmıyorsa ve dosya varsa, akıllı senkronizasyon yap
	if (!force && hasData(symbol, interval)) {
		let cached = loadCandles(symbol, interval);
		
		if (cached.length > 0) {
			const cachedStart = cached[0].openTime;
			const cachedEnd = cached[cached.length - 1].openTime;
			let updated = false;

			// 1) Geçmiş veri eksikse (sol taraf)
			if (startTime !== undefined && startTime < cachedStart) {
				log(`Geçmiş veri eksik, sol taraf senkronize ediliyor: ${new Date(startTime).toISOString()} - ${new Date(cachedStart - 1).toISOString()}`);
				const leftCandles = await getCandles(symbol, interval, startTime, cachedStart - 1);
				if (leftCandles.length > 0) {
					cached = [...leftCandles, ...cached];
					updated = true;
				}
			}

			// 2) Güncel veri eksikse (sağ taraf)
			const targetEnd = endTime !== undefined ? endTime : Date.now();
			// Eğer son mum hedef zamandan eski ise güncel veriyi çek
			if (targetEnd > cachedEnd) {
				log(`Güncel veri eksik, sağ taraf senkronize ediliyor: ${new Date(cachedEnd + 1).toISOString()} - ${new Date(targetEnd).toISOString()}`);
				const rightCandles = await getCandles(symbol, interval, cachedEnd + 1, targetEnd);
				if (rightCandles.length > 0) {
					cached = [...cached, ...rightCandles];
					updated = true;
				}
			}

			// Eğer veri güncellendiyse tekilleştir, sırala ve kaydet
			if (updated) {
				const candleMap = new Map<number, Candle>();
				for (const c of cached) {
					candleMap.set(c.openTime, c);
				}
				const sortedCandles = Array.from(candleMap.values()).sort((a, b) => a.openTime - b.openTime);
				saveCandles(symbol, interval, sortedCandles);
				cached = sortedCandles;
			}

			// İstenen aralığı filtreleyip kes
			let result = cached;
			if (startTime !== undefined) {
				result = result.filter(c => c.openTime >= startTime);
			}
			if (endTime !== undefined) {
				result = result.filter(c => c.openTime <= endTime);
			}
			return result;
		}
	}

	// Dosya yoksa veya force=true ise sıfırdan çek
	const candles = await getCandles(symbol, interval, startTime, endTime);

	if (candles.length === 0) {
		log(`${symbol} için veri bulunamadı.`);
		return [];
	}

	// Dosyaya kaydet
	saveCandles(symbol, interval, candles);

	return candles;
}
