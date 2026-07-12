// ============================================================================
// KRIPTOQUANT — Historical Funding Rate Fetcher & Provider (Sprint 29)
// ============================================================================
// Binance Futures REST API'sinden fonlama oranlarını çeker, yerel diske
// kaydeder ve 90 günlük hareketli persentil (yüzdelik dilim) değerlerini hesaplar.
// ============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../core/utils.js';

export interface FundingRateEntry {
	symbol: string;
	fundingTime: number;
	fundingRate: number;
	fundingPercentile?: number;
}

const BINANCE_FUTURES_URL = 'https://fapi.binance.com';
const FUNDING_ENDPOINT = '/fapi/v1/fundingRate';
const DATA_DIR = join(process.cwd(), 'data', 'raw');

/**
 * Binance Futures API'sinden fonlama oranlarını çeker.
 * Tek istekte maksimum 1000 adet veri dönebilir.
 */
export async function fetchBinanceFunding(
	symbol: string,
	startTime?: number,
	endTime?: number,
	limit = 1000
): Promise<FundingRateEntry[]> {
	const params = new URLSearchParams({
		symbol,
		limit: String(limit),
	});

	if (startTime) params.set('startTime', String(startTime));
	if (endTime) params.set('endTime', String(endTime));

	const url = `${BINANCE_FUTURES_URL}${FUNDING_ENDPOINT}?${params.toString()}`;
	const response = await fetch(url);

	if (!response.ok) {
		const txt = await response.text();
		throw new Error(`Binance Futures API error: ${response.status} - ${txt}`);
	}

	const data = await response.json() as any[];
	return data.map(d => ({
		symbol: d.symbol,
		fundingTime: Number(d.fundingTime),
		fundingRate: Number.parseFloat(d.fundingRate),
	}));
}

/**
 * Fonlama oranları için hareketli (rolling) persentil (yüzdelik dilim) değerlerini hesaplar.
 * windowSize varsayılan olarak 270'tir (90 gün boyunca günde 3 fonlama dönemi).
 */
export function computeFundingPercentiles(entries: FundingRateEntry[], windowSize = 270): FundingRateEntry[] {
	const sorted = [...entries].sort((a, b) => a.fundingTime - b.fundingTime);
	
	for (let i = 0; i < sorted.length; i++) {
		const currentRate = sorted[i].fundingRate;
		const startIdx = Math.max(0, i - windowSize + 1);
		
		let count = 0;
		let total = 0;
		for (let j = startIdx; j <= i; j++) {
			if (sorted[j].fundingRate <= currentRate) {
				count++;
			}
			total++;
		}
		
		sorted[i].fundingPercentile = total > 0 ? count / total : 0.5;
	}
	
	return sorted;
}

/**
 * Belirli bir zaman aralığı için fonlama oranlarını getirir.
 * Lokalde varsa önbellekten yükler, eksikse Binance Futures API'den çeker.
 * 
 * NOT: Persentil hesaplamasının "soğuk başlangıç" (cold start) problemi yaşamaması için,
 * veriler startTime'dan 90 gün öncesinden başlayarak çekilir.
 */
export async function getFundingRates(
	symbol: string,
	startTime: number,
	endTime: number,
	force = false
): Promise<FundingRateEntry[]> {
	if (!existsSync(DATA_DIR)) {
		mkdirSync(DATA_DIR, { recursive: true });
	}

	const filePath = join(DATA_DIR, `funding_${symbol}.json`);
	const fetchStartTime = startTime - 90 * 24 * 60 * 60 * 1000; // 90 gün öncesi (persentil warm-up)

	let cached: FundingRateEntry[] = [];
	if (!force && existsSync(filePath)) {
		try {
			cached = JSON.parse(readFileSync(filePath, 'utf-8'));
		} catch (e) {
			log(`[⚠️] Fonlama önbellek dosyası okunamadı, yeniden çekilecek: ${e}`);
		}
	}

	// Eğer önbellekteki veriler istediğimiz aralığı kapsıyorsa doğrudan kullan
	if (cached.length > 0) {
		const cachedStart = cached[0].fundingTime;
		const cachedEnd = cached[cached.length - 1].fundingTime;
		
		if (cachedStart <= fetchStartTime && cachedEnd >= endTime) {
			return cached.filter(e => e.fundingTime >= startTime && e.fundingTime <= endTime);
		}
	}

	log(`[⚙️] Binance'ten Fonlama Oranları çekiliyor: ${symbol} (${new Date(fetchStartTime).toISOString().slice(0, 10)} - ${new Date(endTime).toISOString().slice(0, 10)})...`);
	
	// Binance'ten verileri parça parça çek (limit 1000 olduğu için gerekirse sayfalama yap)
	const fetched: FundingRateEntry[] = [];
	let cursor = fetchStartTime;
	
	while (cursor < endTime) {
		const chunk = await fetchBinanceFunding(symbol, cursor, endTime, 1000);
		if (chunk.length === 0) break;
		
		fetched.push(...chunk);
		const lastTime = chunk[chunk.length - 1].fundingTime;
		if (lastTime <= cursor) break; // Sonsuz döngü koruması
		cursor = lastTime + 1;
	}

	// Önbellekteki verilerle birleştir ve tekilleştir
	const combinedMap = new Map<number, FundingRateEntry>();
	for (const e of [...cached, ...fetched]) {
		combinedMap.set(e.fundingTime, e);
	}

	const sortedEntries = Array.from(combinedMap.values()).sort((a, b) => a.fundingTime - b.fundingTime);
	
	// Persentil değerlerini hesapla
	const entriesWithPercentile = computeFundingPercentiles(sortedEntries, 270);

	// Önbellek dosyasına kaydet
	try {
		writeFileSync(filePath, JSON.stringify(entriesWithPercentile, null, 2), 'utf-8');
	} catch (e) {
		log(`[⚠️] Fonlama önbellek dosyası kaydedilemedi: ${e}`);
	}

	// İstediğimiz asıl aralığı filtreleyip dön
	return entriesWithPercentile.filter(e => e.fundingTime >= startTime && e.fundingTime <= endTime);
}

/**
 * Mum verileri ile fonlama verilerini zaman damgalarına göre birleştirir.
 * Her muma, o mumun açılışından (openTime) önceki en yakın/güncel fonlama oranını atar.
 */
export function mergeCandlesWithFunding(candles: import('../core/types.js').Candle[], fundingRates: FundingRateEntry[]): import('../core/types.js').Candle[] {
	if (fundingRates.length === 0) return candles;

	// Fonlama oranlarını zaman damgasına göre sırala
	const sortedFunding = [...fundingRates].sort((a, b) => a.fundingTime - b.fundingTime);

	return candles.map(candle => {
		const targetTime = candle.openTime; 

		// sortedFunding içinde targetTime'dan küçük veya eşit olan en son elemanı bul
		let matched: FundingRateEntry | null = null;
		for (const f of sortedFunding) {
			if (f.fundingTime <= targetTime) {
				matched = f;
			} else {
				break;
			}
		}

		const finalMatched = matched || sortedFunding[0];

		return {
			...candle,
			fundingRate: finalMatched.fundingRate,
			fundingPercentile: finalMatched.fundingPercentile,
		};
	});
}
