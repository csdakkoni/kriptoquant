// ============================================================================
// KRIPTOQUANT — Open Interest History Fetcher & Percentile Engine (Sprint 29)
// ============================================================================
// Binance Futures'tan Açık Pozisyon (Open Interest) verilerini çeker,
// rolling percentil hesaplar ve diske kaydeder.
// ============================================================================

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from '../core/types.js';
import { log } from '../core/utils.js';

const DATA_DIR = join(import.meta.dirname, '../../data/raw');

export interface OpenInterestEntry {
	readonly symbol: string;
	readonly sumOpenInterest: string;
	readonly sumOpenInterestValue: string;
	readonly timestamp: number;
}

/**
 * Binance Futures API'sinden bir aralık için Open Interest çeker.
 */
async function fetchBinanceOI(
	symbol: string,
	period: string,
	startTime: number,
	endTime: number,
	limit = 500
): Promise<OpenInterestEntry[]> {
	const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}&startTime=${startTime}&endTime=${endTime}`;
	
	try {
		const res = await fetch(url);
		if (!res.ok) {
			const text = await res.text();
			log(`[⚠️] OI API Hatası (${res.status}): ${text}`);
			return [];
		}
		return (await res.json()) as OpenInterestEntry[];
	} catch (err) {
		log(`[⚠️] Fetch hatası: ${err}`);
		return [];
	}
}

/**
 * Belirlenen aralıkta Open Interest verilerini sayfalayarak çeker.
 * 30 günlük sert geçmiş veri sınırı vardır.
 */
export async function getOpenInterest(
	symbol: string,
	period: string,
	startTime: number,
	endTime: number
): Promise<OpenInterestEntry[]> {
	if (!existsSync(DATA_DIR)) {
		mkdirSync(DATA_DIR, { recursive: true });
	}

	const cacheFile = join(DATA_DIR, `oi_${symbol}_${period}.json`);
	let cached: OpenInterestEntry[] = [];

	if (existsSync(cacheFile)) {
		try {
			cached = JSON.parse(readFileSync(cacheFile, 'utf-8')) as OpenInterestEntry[];
			log(`[💾 CACHE] Diskten ${cached.length} adet OI verisi yüklendi.`);
		} catch (e) {
			log(`[⚠️] Disk cache okuma hatası, baştan çekiliyor...`);
		}
	}

	// 30 günden eskisini çekemeyiz. API sınır koruması:
	const maxFetchableStartTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
	const adjustedStartTime = Math.max(startTime, maxFetchableStartTime);

	// Eksik kısımları belirle
	const cachedTimestamps = new Set(cached.map(e => e.timestamp));
	const toFetch: { start: number; end: number }[] = [];
	
	let cursor = adjustedStartTime;
	// 4 saatlik parçalar halinde çekerek API sınırlarına takılmayı ve boşlukları önleyelim
	const chunkStep = 4 * 60 * 60 * 1000; 

	while (cursor < endTime) {
		const nextCursor = Math.min(cursor + chunkStep, endTime);
		// Bu dilimde hiç veri çekilmemişse veya cache'de yoksa çek listesine ekle
		const hasAny = cached.some(e => e.timestamp >= cursor && e.timestamp < nextCursor);
		if (!hasAny) {
			toFetch.push({ start: cursor, end: nextCursor });
		}
		cursor = nextCursor;
	}

	if (toFetch.length > 0) {
		log(`[⚙️] Binance'ten eksik ${toFetch.length} zaman dilimi için OI verileri çekiliyor...`);
		const newEntries: OpenInterestEntry[] = [];

		for (const chunk of toFetch) {
			const fetched = await fetchBinanceOI(symbol, period, chunk.start, chunk.end, 500);
			if (fetched && fetched.length > 0) {
				newEntries.push(...fetched);
			}
			// API rate limit koruması
			await new Promise(r => setTimeout(r, 100));
		}

		if (newEntries.length > 0) {
			// Birleştir ve tekilleştir
			const combined = [...cached, ...newEntries];
			const uniqueMap = new Map<number, OpenInterestEntry>();
			for (const entry of combined) {
				uniqueMap.set(entry.timestamp, entry);
			}
			cached = Array.from(uniqueMap.values()).sort((a, b) => a.timestamp - b.timestamp);
			writeFileSync(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
			log(`[💾 CACHE GÜNCELLENDİ] Toplam ${cached.length} adet OI verisi kaydedildi.`);
		}
	}

	// İstenen aralıktaki verileri filtrele
	return cached.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);
}

/**
 * Mum verilerini Open Interest ve hareketli persentil değerleriyle birleştirir.
 */
export function mergeCandlesWithOI(
	candles: Candle[],
	oiList: OpenInterestEntry[],
	rollingWindow = 96 // Örnek: 15M barları için 96 bar = 24 saatlik pencere
): Candle[] {
	if (candles.length === 0) return [];
	
	const oiMap = new Map<number, number>();
	for (const entry of oiList) {
		// Binance timestamp saniye hassasiyetinde veya milisaniyede tam uyuşmayabilir.
		// En yakın mum açılış saatine hizalamak için en yakın 15 dakikaya yuvarlarız.
		const roundedTime = Math.floor(entry.timestamp / (15 * 60 * 1000)) * (15 * 60 * 1000);
		oiMap.set(roundedTime, parseFloat(entry.sumOpenInterestValue));
	}

	const result: Candle[] = [];
	const oiValues: number[] = [];

	for (let i = 0; i < candles.length; i++) {
		const candle = candles[i];
		const openTimeRounded = Math.floor(candle.openTime / (15 * 60 * 1000)) * (15 * 60 * 1000);
		const oiVal = oiMap.get(openTimeRounded) ?? (oiValues.length > 0 ? oiValues[oiValues.length - 1] : 0);

		oiValues.push(oiVal);

		// Son N muma göre rolling percentile hesapla
		let oiPercentile = 0.5; // Varsayılan orta seviye
		if (oiValues.length >= 2) {
			const windowStart = Math.max(0, oiValues.length - rollingWindow);
			const windowValues = oiValues.slice(windowStart).sort((a, b) => a - b);
			const rank = windowValues.filter(v => v <= oiVal).length;
			oiPercentile = (rank - 1) / (windowValues.length - 1);
		}

		result.push({
			...candle,
			openInterest: oiVal,
			oiPercentile
		});
	}

	return result;
}
