// ============================================================================
// KRIPTOQUANT — Binance API Client
// ============================================================================
// Binance REST API adapter. Dışarıya sadece Candle[] verir.
// Tüm Binance-spesifik mantık bu dosyada izole edilir.
// ============================================================================

import type { BinanceKline, Candle } from '../core/types.js';
import { log, sleep } from '../core/utils.js';

const BINANCE_BASE_URL = 'https://api.binance.com';
const KLINES_ENDPOINT = '/api/v3/klines';
const MAX_LIMIT = 1000; // Binance tek istekte maks. 1000 mum döner
const RATE_LIMIT_DELAY_MS = 300; // Rate limit aşımını önlemek için bekleme

/**
 * Binance'den ham kline verisini çeker.
 * Sadece bu dosya içinde kullanılır.
 */
async function fetchKlines(
	symbol: string,
	interval: string,
	startTime?: number,
	endTime?: number,
	limit: number = MAX_LIMIT,
): Promise<BinanceKline[]> {
	const params = new URLSearchParams({
		symbol,
		interval,
		limit: String(limit),
	});

	if (startTime) params.set('startTime', String(startTime));
	if (endTime) params.set('endTime', String(endTime));

	const url = `${BINANCE_BASE_URL}${KLINES_ENDPOINT}?${params.toString()}`;
	const response = await fetch(url);

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Binance API error (${response.status}): ${errorBody}`);
	}

	return (await response.json()) as BinanceKline[];
}

/**
 * Ham Binance kline verisini Candle formatına dönüştürür.
 */
function klineToCandle(kline: BinanceKline): Candle {
	return {
		openTime: kline[0],
		open: Number.parseFloat(kline[1]),
		high: Number.parseFloat(kline[2]),
		low: Number.parseFloat(kline[3]),
		close: Number.parseFloat(kline[4]),
		volume: Number.parseFloat(kline[5]),
		closeTime: kline[6],
	};
}

/**
 * Belirtilen coin ve zaman aralığı için tarihsel mum verilerini çeker.
 *
 * Binance API tek istekte maks. 1000 mum döner. Bu fonksiyon
 * gerektiğinde birden fazla istek yaparak tüm veriyi toplar.
 *
 * @param symbol - Coin sembolü (ör. "BTCUSDT")
 * @param interval - Mum aralığı (ör. "1d", "1h", "15m")
 * @param startTime - Başlangıç zamanı (Unix ms). Opsiyonel.
 * @param endTime - Bitiş zamanı (Unix ms). Opsiyonel.
 * @returns Kronolojik sıralanmış Candle dizisi
 */
export async function getCandles(
	symbol: string,
	interval: string,
	startTime?: number,
	endTime?: number,
): Promise<Candle[]> {
	const allCandles: Candle[] = [];
	let currentStartTime = startTime;

	log(`${symbol} verisi çekiliyor (${interval})...`);

	while (true) {
		const klines = await fetchKlines(symbol, interval, currentStartTime, endTime);

		if (klines.length === 0) break;

		const candles = klines.map(klineToCandle);
		allCandles.push(...candles);

		log(`  → ${candles.length} mum alındı (toplam: ${allCandles.length})`);

		// Binance tam sayfa döndüyse, daha fazla veri olabilir
		if (klines.length < MAX_LIMIT) break;

		// Bir sonraki sayfanın başlangıcı = son mumun kapanış zamanı + 1
		currentStartTime = klines[klines.length - 1][6] + 1;

		// Rate limit koruması
		await sleep(RATE_LIMIT_DELAY_MS);
	}

	log(`${symbol}: toplam ${allCandles.length} mum çekildi.`);
	return allCandles;
}
