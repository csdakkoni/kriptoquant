// ============================================================================
// KRIPTOQUANT RESEARCH — Swing Dip Lab (Kullanıcının "10'dan al 11'den sat" testi)
// ============================================================================
// Kullanıcı örneği: coin tepeden %D düşünce AL, %T yükselince SAT, %S daha
// düşerse ZARAR KES. Scalp değil swing ölçeği (%3-12 hedefler) — bu ölçekte
// komisyonun (%0.2 gidiş-dönüş) etkisi önemsizleşir.
// Kurallar:
//  - Giriş: kapanış, son 48 saatin tepesinden %D aşağıya indiği an (market, taker).
//  - TP: giriş * (1+T) — limit dolum (high trade-through şartı).
//  - SL: giriş * (1-S) — stop-market, slipajlı. Aynı mumda SL+TP → ZARAR sayılır.
//  - Zaman stopu: 168 saat (7 gün), kapanıştan çıkış.
//  - Re-arm: çıkıştan sonra fiyat dip çizgisinin üstüne çıkmadan tekrar girilmez
//    (uzun düşüşte üst üste alım yapmayı engeller — merdivenleme yok).
// Çalıştır: npx tsx src/research/experiments/swing_dip_lab.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { sma } from '../../core/indicators/index.js';
import type { Candle } from '../../core/types.js';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT', 'XRPUSDT'];
const INTERVAL = '1h';
const DAYS = 365;
const LOOKBACK = 48; // tepe için 48 saat
const MAX_BARS = 168; // 7 gün zaman stopu

const FEE = 0.001;
const SLIP = 0.0005;
const TRADE_THROUGH = 1.001;

interface Combo { d: number; t: number; s: number; }
const combos: Combo[] = [
	{ d: 3, t: 3, s: 3 },
	{ d: 3, t: 5, s: 5 },
	{ d: 5, t: 5, s: 5 },
	{ d: 5, t: 8, s: 5 },
	{ d: 5, t: 10, s: 8 },
	{ d: 8, t: 8, s: 8 },
	{ d: 8, t: 12, s: 8 },
	{ d: 10, t: 10, s: 10 }, // kullanıcının örneği: 11'den 10'a düşeni al (~%9), 11'de sat (+%10)
];

interface SimResult {
	trades: number; wins: number; gp: number; gl: number;
	netReturnPct: number; maxDD: number; tpE: number; slE: number; tiE: number;
}

function simulate(candles: Candle[], combo: Combo, riskOnAt?: (ts: number) => boolean): SimResult {
	const ALLOC = 0.15;
	let equity = 1, peak = 1, maxDD = 0;
	let trades = 0, wins = 0, gp = 0, gl = 0, tpE = 0, slE = 0, tiE = 0;

	let inPos = false, armed = true;
	let entry = 0, tpLevel = 0, slLevel = 0, barsHeld = 0;

	for (let i = LOOKBACK; i < candles.length; i++) {
		const c = candles[i];
		let rollHigh = 0;
		for (let j = i - LOOKBACK; j < i; j++) if (candles[j].high > rollHigh) rollHigh = candles[j].high;
		const dipLine = rollHigh * (1 - combo.d / 100);

		if (!inPos) {
			if (!armed) {
				// Re-arm: fiyat dip çizgisinin üstüne dönmeli
				if (c.close > dipLine) armed = true;
			} else if (c.close <= dipLine) {
				const gateOk = !riskOnAt || riskOnAt(c.closeTime);
				if (gateOk) {
					entry = c.close * (1 + SLIP); // market alış, slipajlı
					tpLevel = entry * (1 + combo.t / 100);
					slLevel = entry * (1 - combo.s / 100);
					barsHeld = 0;
					inPos = true;
				} else {
					armed = false; // rejim kapalıyken bu dip olayını harca
				}
			}
		} else {
			barsHeld++;
			let exited = false, ret = 0;

			if (c.low <= slLevel) {
				const exitPx = slLevel * (1 - SLIP);
				ret = (exitPx / entry) * (1 - FEE) / (1 + FEE) - 1;
				slE++; exited = true;
			} else if (c.high >= tpLevel * TRADE_THROUGH) {
				ret = (tpLevel / entry) * (1 - FEE) / (1 + FEE) - 1;
				tpE++; exited = true;
			} else if (barsHeld >= MAX_BARS) {
				const exitPx = c.close * (1 - SLIP);
				ret = (exitPx / entry) * (1 - FEE) / (1 + FEE) - 1;
				tiE++; exited = true;
			}

			if (exited) {
				equity *= 1 + ret * ALLOC;
				trades++;
				if (ret > 0) { wins++; gp += ret; } else gl += Math.abs(ret);
				inPos = false;
				armed = false; // yeni girişten önce fiyat toparlanmalı
			}
		}

		if (equity > peak) peak = equity;
		const dd = ((peak - equity) / peak) * 100;
		if (dd > maxDD) maxDD = dd;
	}

	return { trades, wins, gp, gl, netReturnPct: (equity - 1) * 100, maxDD, tpE, slE, tiE };
}

function buildRegimeIndex(btc4h: Candle[]): (ts: number) => boolean {
	const closes = btc4h.map((c) => c.close);
	const sma200 = sma(closes, 200);
	const times = btc4h.map((c) => c.openTime);
	return (ts: number): boolean => {
		let lo = 0, hi = times.length - 1, idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (times[mid] <= ts) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
		}
		if (idx < 0 || Number.isNaN(sma200[idx])) return true;
		return closes[idx] > sma200[idx];
	};
}

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 86400000;

	const btc4h = await fetchAndStore('BTCUSDT', '4h', { startTime: startTime - 40 * 86400000, endTime });
	const isRiskOn = buildRegimeIndex(btc4h);

	const candlesByCoin = new Map<string, Candle[]>();
	for (const coin of COINS) {
		candlesByCoin.set(coin, await fetchAndStore(coin, INTERVAL, { startTime, endTime }));
	}

	console.log(`\n🌊 SWING DIP LAB — "tepeden %D düşünce al, %T'de sat, %S'de kes" | ${COINS.length} coin | 1h | ${DAYS} gün`);
	console.log(`${'combo'.padEnd(28)} rejim   işlem    WR      PF  ort.getiri  en kötü DD   TP/SL/Time`);
	console.log('─'.repeat(100));

	for (const combo of combos) {
		for (const gated of [false, true]) {
			let trades = 0, wins = 0, gp = 0, gl = 0, sumRet = 0, worstDD = 0, tpE = 0, slE = 0, tiE = 0;
			for (const coin of COINS) {
				const candles = candlesByCoin.get(coin)!;
				if (!candles || candles.length < 300) continue;
				const r = simulate(candles, combo, gated ? isRiskOn : undefined);
				trades += r.trades; wins += r.wins; gp += r.gp; gl += r.gl;
				sumRet += r.netReturnPct; worstDD = Math.max(worstDD, r.maxDD);
				tpE += r.tpE; slE += r.slE; tiE += r.tiE;
			}
			const wr = trades > 0 ? (wins / trades) * 100 : 0;
			const pf = gl > 0 ? gp / gl : 0;
			const label = `Dip%${combo.d} TP+%${combo.t} SL-%${combo.s}`;
			console.log(
				`${label.padEnd(28)} ${(gated ? 'AÇIK ' : 'KAPALI').padEnd(6)} ${String(trades).padStart(6)}  ${wr.toFixed(1).padStart(5)}%  ${pf.toFixed(3).padStart(6)}  ${(sumRet / COINS.length).toFixed(2).padStart(9)}%  ${worstDD.toFixed(2).padStart(9)}%   ${tpE}/${slE}/${tiE}`,
			);
		}
	}

	console.log('\nBitti.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
