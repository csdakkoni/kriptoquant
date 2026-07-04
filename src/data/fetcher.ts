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

	// Cache kontrolü: veri varsa ve force değilse, dosyadan oku
	if (!force && hasData(symbol, interval)) {
		log(`${symbol} verisi zaten mevcut, dosyadan yükleniyor...`);
		return loadCandles(symbol, interval);
	}

	// API'den çek
	const candles = await getCandles(symbol, interval, startTime, endTime);

	if (candles.length === 0) {
		log(`${symbol} için veri bulunamadı.`);
		return [];
	}

	// Dosyaya kaydet
	saveCandles(symbol, interval, candles);

	return candles;
}
