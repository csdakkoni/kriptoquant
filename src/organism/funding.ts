// ============================================================================
// ORGANISM — Funding Ücreti Takibi
// ============================================================================
// Futures'ta pozisyon tutmanın bedeli: her funding anında (çoğu coinde 8 saatte
// bir) pozisyon değeri × funding oranı kadar ücret el değiştirir. Oran pozitifse
// LONG'lar öder, SHORT'lar alır; negatifse tersi. Boğa dönemlerinde oran
// %0.01–%0.1 arasına çıkabilir — günlerce tutulan pozisyonda bu, komisyondan
// büyük bir maliyettir ve paper sonuçlarında görünmezse sonuç yanıltır.
//
// Oranlar Binance'in herkese açık geçmiş funding verisinden çekilir (API anahtarı
// gerekmez) ve organism-data/funding-rates.json dosyasında saklanır. Veri
// alınamayan dönemler için muhafazakâr varsayım kullanılır: her 8 saatte %0.01,
// pozisyon yönü ne olursa olsun MALİYET olarak.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log, logError } from '../core/utils.js';

const FUTURES_REST = process.env.FUTURES_REST_URL || 'https://fapi.binance.com';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const KEEP_MS = 45 * 24 * 60 * 60 * 1000; // 45 gün geçmiş yeter
/** Veri yokken 8 saat başına varsayılan funding maliyeti (%) */
export const DEFAULT_FUNDING_PCT_PER_8H = 0.01;

interface FundingRecord {
	time: number;
	rate: number; // ondalık (0.0001 = %0.01)
}

export class FundingTracker {
	private rates = new Map<string, FundingRecord[]>();
	private dataDir?: string;

	constructor(dataDir?: string) {
		this.dataDir = dataDir;
		this.load();
	}

	private getFile(): string {
		const dir = this.dataDir || process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');
		return join(dir, 'funding-rates.json');
	}

	private load(): void {
		try {
			const file = this.getFile();
			if (!existsSync(file)) return;
			const data = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, FundingRecord[]>;
			for (const [coin, list] of Object.entries(data)) this.rates.set(coin, list);
		} catch (e) {
			logError(`[FUNDING] Kayıtlı oranlar okunamadı: ${e}`);
		}
	}

	private save(): void {
		try {
			const file = this.getFile();
			const dir = join(file, '..');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(file, JSON.stringify(Object.fromEntries(this.rates)));
		} catch (e) {
			logError(`[FUNDING] Oranlar kaydedilemedi: ${e}`);
		}
	}

	/** Yeni funding kayıtlarını ekler (aynı zaman damgası tekrar eklenmez) */
	record(coin: string, records: FundingRecord[]): void {
		const list = this.rates.get(coin) ?? [];
		const known = new Set(list.map((r) => r.time));
		for (const r of records) {
			if (!known.has(r.time) && Number.isFinite(r.rate)) list.push(r);
		}
		list.sort((a, b) => a.time - b.time);
		const cutoff = Date.now() - KEEP_MS;
		this.rates.set(
			coin,
			list.filter((r) => r.time >= cutoff),
		);
	}

	/** Borsadan son funding kayıtlarını çeker (her 15 dakikada bir çağrılır) */
	async refresh(coins: string[]): Promise<void> {
		let ok = 0;
		for (const coin of coins) {
			try {
				const last = this.rates.get(coin)?.at(-1)?.time;
				const start = last ? last + 1 : Date.now() - 7 * 24 * 60 * 60 * 1000;
				const res = await fetch(`${FUTURES_REST}/fapi/v1/fundingRate?symbol=${coin}&startTime=${start}&limit=1000`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { fundingTime: number; fundingRate: string }[];
				this.record(
					coin,
					data.map((d) => ({ time: Number(d.fundingTime), rate: Number(d.fundingRate) })),
				);
				ok++;
				await new Promise((r) => setTimeout(r, 100)); // rate limit nezaketi
			} catch (err) {
				logError(`[FUNDING] ${coin} funding verisi alınamadı: ${err}`);
			}
		}
		this.save();
		if (ok < coins.length) log(`[FUNDING] ${ok}/${coins.length} coinin funding verisi güncellendi.`);
	}

	/**
	 * (fromMs, toMs] aralığındaki funding MALİYETİ (%, pozitif = zarar).
	 * Kayıtlar aralığı kapsıyorsa gerçek oranlar, kapsamıyorsa varsayılan kullanılır.
	 */
	fundingCostPct(coin: string, side: 'long' | 'short', fromMs: number, toMs: number): number {
		if (!(toMs > fromMs)) return 0;
		const list = this.rates.get(coin) ?? [];
		const covered =
			list.length > 0 && list[0].time <= fromMs + EIGHT_HOURS && list[list.length - 1].time >= toMs - EIGHT_HOURS;

		if (covered) {
			const sign = side === 'short' ? -1 : 1;
			return list
				.filter((r) => r.time > fromMs && r.time <= toMs)
				.reduce((sum, r) => sum + sign * r.rate * 100, 0);
		}

		// Veri yok: aralıktaki 8 saatlik funding anlarını (00/08/16 UTC) say
		const settlements = Math.floor(toMs / EIGHT_HOURS) - Math.floor(fromMs / EIGHT_HOURS);
		return settlements * DEFAULT_FUNDING_PCT_PER_8H;
	}
}

/** Uygulama genelinde paylaşılan tek örnek */
export const fundingTracker = new FundingTracker();
