// ============================================================================
// ORGANISM — Regime Detector (Piyasa Rejim Dedektörü)
// ============================================================================
// Canlı verinin kanıtladığı gerçek: bu piyasada kazandıran şey giriş/çıkış
// işçiliği değil, YÖN (Random LONG -16.9% vs Random SHORT +7.6% — aynı kural).
// Bu modül yönü sistematik seçer:
//
//   BTC 4h — 50-SMA'nın 200-SMA'ya farkı (golden/death cross):
//     > +%1  → BULL  (boğa — long motoru)
//     < -%1  → BEAR  (ayı — short motoru)
//     ±%1 içi → CHOP (kararsız/yatay — NAKİT, yeni pozisyon yok)
//
// ±%1 tampon bandı testere (whipsaw) sigortasıdır: BULL→BEAR geçişi için
// iki ortalamanın bandı boydan boya geçmesi gerekir; kesişime sürtünmeler
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

// ─── Karar kuralı: Golden/Death Cross (50-SMA vs 200-SMA) ───────────────────
// 1 Ağu'da yapılan tarihsel doğrulama (667 gün, 4h BTC, veri ikiye bölünüp
// her yarıda ayrı ayrı sınandı — BTC rejimi → altcoin 3 günlük getirisi):
//
//   ESKİ  fiyatın 200-SMA'ya uzaklığı ±2% : ayrım +0.24  (yarılar +0.08/+0.11)
//   YENİ  50-SMA vs 200-SMA farkı    ±1% : ayrım +0.65  (yarılar +0.38/+0.63)
//
// Eski kural "fiyat ortalamanın üstünde mi" diye bakıyordu; bu, tek bir sert
// hareketle BULL'a geçip günlerce orada kalabiliyordu (24 Tem: BTC üç gün
// düşerken rejim hâlâ BOĞA deyip long aldı). İki ortalamanın kesişimi ise
// trendin KENDİSİNİ ölçer, anlık sapmayı değil.
//
// NOT: Bant genişliği taramasında geniş bantlar (±5-10%) tüm veride daha iyi
// görünüp ikiye bölününce çöktü — klasik aşırı-uyum. ±1% hem tutarlı hem de
// bant duyarlılığı düşük (0-3% arası tüm değerler iki yarıda da pozitif).
const FAST_PERIOD = 50;
const SLOW_PERIOD = 200;
const BAND_PCT = 1.0; // 50-SMA ile 200-SMA arasındaki fark eşiği
const REFRESH_MS = 15 * 60 * 1000; // 15 dakikada bir tazele

export class RegimeDetector {
	private state: MarketRegime = 'UNKNOWN';
	private distancePct = 0; // 50-SMA'nın 200-SMA'ya farkı (%)
	private btcPrice = 0;
	private sma200 = 0;
	private sma50 = 0;
	private lastFetch = 0;
	private fetching = false;

	/** Mevcut rejimi döndürür; bayatsa arka planda tazeler. */
	getRegime(): MarketRegime {
		this.refreshIfStale();
		return this.state;
	}

	getSnapshot(): { state: MarketRegime; distancePct: number; btcPrice: number; sma200: number; sma50: number } {
		return { state: this.state, distancePct: this.distancePct, btcPrice: this.btcPrice, sma200: this.sma200, sma50: this.sma50 };
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
				this.sma50 = snap.sma50;
				this.lastFetch = Date.now();
				this.persist();
				if (prev !== snap.state) {
					const label = { BULL: '🐂 BOĞA', BEAR: '🐻 AYI', CHOP: '➡️ YATAY', UNKNOWN: '❓' }[snap.state];
					log(`[Rejim] Değişti: ${prev} → ${snap.state} ${label} (BTC ${snap.btcPrice.toFixed(0)}, 50/200 farkı ${snap.distancePct >= 0 ? '+' : ''}${snap.distancePct.toFixed(2)}%)`);
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

	private async fetchRegime(): Promise<{ state: MarketRegime; distancePct: number; btcPrice: number; sma200: number; sma50: number }> {
		const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=210');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as any[];
		if (!Array.isArray(data) || data.length < SLOW_PERIOD) {
			return { state: 'UNKNOWN', distancePct: 0, btcPrice: 0, sma200: 0, sma50: 0 };
		}

		const closes = data.map((d) => parseFloat(d[4]));
		const avg = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
		const smaSlow = avg(SLOW_PERIOD);
		const smaFast = avg(FAST_PERIOD);
		const last = closes[closes.length - 1];

		// Trendin kendisi: hızlı ortalama yavaşın ne kadar üstünde/altında
		const distancePct = ((smaFast - smaSlow) / smaSlow) * 100;

		let state: MarketRegime;
		if (distancePct > BAND_PCT) state = 'BULL';
		else if (distancePct < -BAND_PCT) state = 'BEAR';
		else state = 'CHOP';

		return { state, distancePct, btcPrice: last, sma200: smaSlow, sma50: smaFast };
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
						sma50: Number(this.sma50.toFixed(2)),
						rule: 'golden-cross-50-200',
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
