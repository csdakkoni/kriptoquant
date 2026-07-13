// ============================================================================
// KRIPTOQUANT RESEARCH — Capitulation Lab (Likidasyon Avcısı Etüdü)
// ============================================================================
// Hipotez ("çılgın kanat" adayı #1): Likidasyon şelalesi mumlarında satıcılar
// ZORLA satar (margin call fiyata bakmaz). Zorunlu satıcıdan alım, küçük
// oyuncuya açık nadir yapısal avantajlardan biridir.
// Olay tanımı (15m): tek mumda getiri <= -%2.5 VE hacim >= 4x SMA20(hacim).
// Ölçüm: olay mumu kapanışından +1s, +4s, +8s, +24s ileriye net getiri.
// Bu bir strateji DEĞİL, olay etüdü — sinyalin var olup olmadığını ölçer.
// Çalıştır: npx tsx src/research/experiments/capitulation_lab.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { sma } from '../../core/indicators/index.js';
import type { Candle } from '../../core/types.js';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT', 'XRPUSDT'];
const DAYS = 365;
const DROP_TH = -2.5; // tek mum % düşüş eşiği
const VOL_MULT = 4; // hacim patlaması eşiği
const HORIZONS = [4, 16, 32, 96]; // 15m mum sayısı: 1s, 4s, 8s, 24s
const COST = 0.3; // gidiş-dönüş % maliyet (taker varsayımı)

interface Bucket { n: number; sum: number; wins: number; rets: number[]; }
const mk = (): Bucket => ({ n: 0, sum: 0, wins: 0, rets: [] });

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 86400000;

	console.log(`\n🩸 CAPITULATION LAB — zorla satış mumlarından sonra ne oluyor? | ${COINS.length} coin | 15m | ${DAYS} gün`);
	console.log(`   Olay: tek mumda <= ${DROP_TH}% VE hacim >= ${VOL_MULT}x ort. | maliyet varsayımı %${COST} tur\n`);

	const buckets = new Map<number, Bucket>();
	for (const h of HORIZONS) buckets.set(h, mk());
	let events = 0;

	for (const coin of COINS) {
		const candles: Candle[] = await fetchAndStore(coin, '15m', { startTime, endTime });
		if (candles.length < 200) continue;
		const volumes = candles.map((c) => c.volume);
		const volSma = sma(volumes, 20);

		let lastEventIdx = -100;
		for (let i = 21; i < candles.length - Math.max(...HORIZONS); i++) {
			const c = candles[i];
			const prev = candles[i - 1];
			const ret = ((c.close - prev.close) / prev.close) * 100;
			const volOk = !Number.isNaN(volSma[i]) && volSma[i] > 0 && c.volume >= VOL_MULT * volSma[i];

			if (ret <= DROP_TH && volOk && i - lastEventIdx >= 16) {
				// üst üste binen olayları sayma (min 4 saat ara)
				lastEventIdx = i;
				events++;
				for (const h of HORIZONS) {
					const fwd = ((candles[i + h].close - c.close) / c.close) * 100;
					const b = buckets.get(h)!;
					b.n++;
					b.sum += fwd;
					b.rets.push(fwd);
					if (fwd > COST) b.wins++; // maliyet sonrası kazanç
				}
			}
		}
	}

	console.log(`Toplam olay: ${events} (${(events / (DAYS / 30)).toFixed(1)}/ay, 6 coin toplamı)\n`);
	console.log(`ufuk      n     ort.getiri   medyan    maliyet sonrası kazanma`);
	console.log('─'.repeat(66));
	for (const h of HORIZONS) {
		const b = buckets.get(h)!;
		const avg = b.n > 0 ? b.sum / b.n : 0;
		const sorted = [...b.rets].sort((a, z) => a - z);
		const med = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
		const wr = b.n > 0 ? (b.wins / b.n) * 100 : 0;
		const hours = (h * 15) / 60;
		console.log(
			`+${String(hours).padEnd(4)}s ${String(b.n).padStart(5)}   ${avg.toFixed(2).padStart(8)}%  ${med.toFixed(2).padStart(7)}%   %${wr.toFixed(1)}`,
		);
	}

	// Karşılaştırma: rastgele zamanlarda aynı ufuklar (baseline drift)
	console.log(`\nKarşılaştırma (aynı dönemde rastgele giriş, ayı drifti):`);
	for (const h of HORIZONS) {
		let n = 0, sum = 0;
		for (const coin of COINS) {
			const candles: Candle[] = await fetchAndStore(coin, '15m', { startTime, endTime });
			for (let i = 21; i < candles.length - h; i += 97) {
				sum += ((candles[i + h].close - candles[i].close) / candles[i].close) * 100;
				n++;
			}
		}
		console.log(`+${String((h * 15) / 60).padEnd(4)}s baseline ort: ${(sum / n).toFixed(3)}%`);
	}

	console.log('\nBitti.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
