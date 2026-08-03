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

// Testlerin gerçek durumu ezmemesi için dizin ORGANISM_DATA_DIR ile değiştirilebilir
const STATE_DIR = process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');
const REGIME_FILE = join(STATE_DIR, 'regime.json');

export type MarketRegime = 'BULL' | 'BEAR' | 'CHOP' | 'UNKNOWN';

// ─── Karar kuralı: Golden/Death Cross (50-SMA vs 200-SMA) ───────────────────
//
// ⚠️ DÜRÜSTLÜK NOTU — BU SİNYALİN KANITLANMIŞ BİR EDGE'İ YOKTUR.
//
// 1 Ağu: 667 günlük 4h BTC verisi 8 ayrı ~90 günlük döneme bölünüp her
// dönemde ayrı ayrı ölçüldü (BTC rejimi → 5 coinin 3 günlük getirisi,
// ayrım = BULL sonrası ort. getiri − BEAR sonrası ort. getiri):
//
//   Golden Cross 50/200 : 8 dönemin sadece 3'ünde pozitif, dönem ortalaması -0.74
//   Eski kural (fiyat vs 200-SMA ±2%) : 8 dönemin 1'inde pozitif, ortalama -1.64
//
// Yani ikisi de yazı-turadan ayırt edilemiyor. Tüm veride golden cross'un
// pozitif görünmesi (+0.19) tek bir şanslı döneme (2025-02→05, +3.47)
// dayanıyor; dönemler eşit ağırlıklandırıldığında işaret NEGATİFE dönüyor.
//
// Bu kural yine de korunuyor çünkü eski kuraldan daha az kötü (3/8 vs 1/8) ve
// yönü rastgele seçmekten daha kötü olduğuna dair kanıt da yok. AMA:
//   • "Rejim anahtarı çalışıyor" bir VARSAYIMDIR, kanıtlanmış bir edge değil.
//   • Üstüne yeni katman inşa edilmemeli; canlı deneyler nihai hakemdir.
//
// Ayrıca kaydedilen iki negatif bulgu (tekrar denenmesin):
//   • Hızlı ortalamalar sinyali TERSİNE çevirir (30-SMA ayrım -0.43).
//   • Geniş bantlar tüm veride parlayıp alt dönemlerde çöker (aşırı-uyum).
//   • Denenip elenen diğer kavramlar: piyasa genişliği, yavaş trend (100/300),
//     volatiliteye normalize trend, çok-zamanlı uyum, zirveden düşüş,
//     3'lü oylama — hiçbiri alt dönemlerde tutarlı değil.
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
