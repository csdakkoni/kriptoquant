// ============================================================================
// ORGANISM — Regime Detector (Piyasa Rejim Dedektörü)
// ============================================================================
// Canlı verinin kanıtladığı gerçek: bu piyasada kazandıran şey giriş/çıkış
// işçiliği değil, YÖN (Random LONG -16.9% vs Random SHORT +7.6% — aynı kural).
// Bu modül yönü sistematik seçer:
//
//   BTC 4h kapanışı, 200-SMA'ya göre:
//     > +%2  → BULL  (boğa — long motoru)
//     < -%2  → BEAR  (ayı — short motoru)
//     ±%2 içi → CHOP (kararsız/yatay — NAKİT, yeni pozisyon yok)
//
// ±%2 tampon bandı testere (whipsaw) sigortasıdır: BULL→BEAR geçişi için
// fiyatın 4 puanlık bandı boydan boya geçmesi gerekir; SMA'ya sürtünmeler
// motor değiştirmez, sadece nakde çeker.
//
// Durum organism-data/regime.json'a yazılır — dashboard ayrı süreç olduğu
// için dosya üzerinden okur.
// ============================================================================

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { log, logError } from '../core/utils.js';

const STATE_DIR = join(process.cwd(), 'organism-data');
const REGIME_FILE = join(STATE_DIR, 'regime.json');

export type MarketRegime = 'BULL' | 'BEAR' | 'CHOP' | 'UNKNOWN';

const BAND_PCT = 2.0; // ±%2 tampon bandı
const REFRESH_MS = 15 * 60 * 1000; // 15 dakikada bir tazele

export class RegimeDetector {
	private state: MarketRegime = 'UNKNOWN';
	private distancePct = 0; // SMA'ya uzaklık (%)
	private btcPrice = 0;
	private sma200 = 0;
	private lastFetch = 0;
	private fetching = false;

	/** Mevcut rejimi döndürür; bayatsa arka planda tazeler. */
	getRegime(): MarketRegime {
		this.refreshIfStale();
		return this.state;
	}

	getSnapshot(): { state: MarketRegime; distancePct: number; btcPrice: number; sma200: number } {
		return { state: this.state, distancePct: this.distancePct, btcPrice: this.btcPrice, sma200: this.sma200 };
	}

	private refreshIfStale(): void {
		const now = Date.now();
		if (this.fetching || now - this.lastFetch < REFRESH_MS) return;
		this.fetching = true;

		this.fetchRegime()
			.then((snap) => {
				const prev = this.state;
				this.state = snap.state;
				this.distancePct = snap.distancePct;
				this.btcPrice = snap.btcPrice;
				this.sma200 = snap.sma200;
				this.lastFetch = Date.now();
				this.persist();
				if (prev !== snap.state) {
					const label = { BULL: '🐂 BOĞA', BEAR: '🐻 AYI', CHOP: '➡️ YATAY', UNKNOWN: '❓' }[snap.state];
					log(`[Rejim] Değişti: ${prev} → ${snap.state} ${label} (BTC ${snap.btcPrice.toFixed(0)}, SMA200'e uzaklık ${snap.distancePct >= 0 ? '+' : ''}${snap.distancePct.toFixed(2)}%)`);
				}
			})
			.catch((e) => {
				logError(`[Rejim] Veri alınamadı (mevcut: ${this.state}): ${e}`);
				this.lastFetch = Date.now(); // hata durumunda da bekle, API'yi dövme
			})
			.finally(() => {
				this.fetching = false;
			});
	}

	private async fetchRegime(): Promise<{ state: MarketRegime; distancePct: number; btcPrice: number; sma200: number }> {
		const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=210');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as any[];
		if (!Array.isArray(data) || data.length < 200) return { state: 'UNKNOWN', distancePct: 0, btcPrice: 0, sma200: 0 };

		const closes = data.map((d) => parseFloat(d[4]));
		const sma = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
		const last = closes[closes.length - 1];
		const distancePct = ((last - sma) / sma) * 100;

		let state: MarketRegime;
		if (distancePct > BAND_PCT) state = 'BULL';
		else if (distancePct < -BAND_PCT) state = 'BEAR';
		else state = 'CHOP';

		return { state, distancePct, btcPrice: last, sma200: sma };
	}

	private persist(): void {
		try {
			if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
			writeFileSync(
				REGIME_FILE,
				JSON.stringify(
					{
						state: this.state,
						distancePct: Number(this.distancePct.toFixed(2)),
						btcPrice: this.btcPrice,
						sma200: Number(this.sma200.toFixed(2)),
						bandPct: BAND_PCT,
						updatedAt: new Date().toISOString(),
					},
					null,
					2,
				),
			);
		} catch (e) {
			logError(`[Rejim] Durum dosyası yazılamadı: ${e}`);
		}
	}
}
