// ============================================================================
// KRIPTOQUANT RESEARCH — İki Kanat Lab (Short bacağı + Al-Bekle)
// ============================================================================
// Kullanıcı vizyonu: her piyasa koşuluna uygun strateji barındıran sistem.
// Bugüne dek test edilen 76 konfigürasyonun tamamı LONG'du — ayı yılında
// yapısal dezavantaj. Bu deney eksik kanatları test eder:
//  S1) Trend Short: Donchian 20 alt bant kırılımında short, üst bantta kapat.
//  S2) Rally Fade Short: 48s dibinden +%10 yükseleni short, -%10'da TP.
//  H1) Rejim Long (al-bekle): BTC 4h 200-SMA üstüne çıkınca al,
//      altına inince sat (aylarca tutabilir).
// Futures varsayımları: 1x kaldıraç, %0.05 komisyon/yön, %0.05 slipaj,
// funding ihmal (not: ayıda funding çoğunlukla short lehine/nötr).
// Çalıştır: npx tsx src/research/experiments/two_wing_lab.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { donchianChannel, sma } from '../../core/indicators/index.js';
import type { Candle } from '../../core/types.js';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT', 'XRPUSDT'];
const DAYS = 365;
const FEE = 0.0005; // futures taker
const SLIP = 0.0005;
const ALLOC = 0.15;

interface SimResult {
	trades: number; wins: number; gp: number; gl: number;
	netReturnPct: number; maxDD: number;
}

function newResult(): SimResult {
	return { trades: 0, wins: 0, gp: 0, gl: 0, netReturnPct: 0, maxDD: 0 };
}

function record(r: SimResult, ret: number, equityRef: { e: number; peak: number }) {
	equityRef.e *= 1 + ret * ALLOC;
	r.trades++;
	if (ret > 0) { r.wins++; r.gp += ret; } else r.gl += Math.abs(ret);
	if (equityRef.e > equityRef.peak) equityRef.peak = equityRef.e;
	const dd = ((equityRef.peak - equityRef.e) / equityRef.peak) * 100;
	if (dd > r.maxDD) r.maxDD = dd;
}

// Short getiri: (giriş - çıkış)/giriş, iki yön komisyon
function shortRet(entry: number, exit: number): number {
	return (entry - exit) / entry - 2 * FEE;
}
function longRet(entry: number, exit: number): number {
	return (exit - entry) / entry - 2 * FEE;
}

// S1: Donchian 20 short (4h)
function simTrendShort(candles: Candle[]): SimResult {
	const r = newResult();
	const eq = { e: 1, peak: 1 };
	const { upper, lower } = donchianChannel(candles, 20);
	let inPos = false, entry = 0, stop = 0;

	for (let i = 21; i < candles.length; i++) {
		const c = candles[i];
		if (Number.isNaN(upper[i]) || Number.isNaN(lower[i])) continue;

		if (!inPos) {
			// Alt bandın altına kapanış → short (kırılımı takip et)
			if (c.close < lower[i]) {
				entry = c.close * (1 - SLIP);
				stop = entry * 1.06; // +%6 üstüne çıkarsa kes
				inPos = true;
			}
		} else {
			if (c.high >= stop) {
				record(r, shortRet(entry, stop * (1 + SLIP)), eq);
				inPos = false;
			} else if (c.close > upper[i]) {
				// Üst bant kırılımı → short kapat
				record(r, shortRet(entry, c.close * (1 + SLIP)), eq);
				inPos = false;
			}
		}
	}
	if (inPos) record(r, shortRet(entry, candles[candles.length - 1].close), eq);
	r.netReturnPct = (eq.e - 1) * 100;
	return r;
}

// S2: Rally fade short (1h): 48s dibinden +%R yükseleni short, -%T'de TP, +%S'de SL
function simRallyFade(candles: Candle[], risePct: number, tpPct: number, slPct: number): SimResult {
	const r = newResult();
	const eq = { e: 1, peak: 1 };
	const LOOKBACK = 48, MAX_BARS = 168;
	let inPos = false, armed = true, entry = 0, tp = 0, sl = 0, barsHeld = 0;

	for (let i = LOOKBACK; i < candles.length; i++) {
		const c = candles[i];
		let rollLow = Infinity;
		for (let j = i - LOOKBACK; j < i; j++) if (candles[j].low < rollLow) rollLow = candles[j].low;
		const rallyLine = rollLow * (1 + risePct / 100);

		if (!inPos) {
			if (!armed) {
				if (c.close < rallyLine) armed = true;
			} else if (c.close >= rallyLine) {
				entry = c.close * (1 - SLIP);
				tp = entry * (1 - tpPct / 100);
				sl = entry * (1 + slPct / 100);
				barsHeld = 0;
				inPos = true;
			}
		} else {
			barsHeld++;
			// Kötümser: önce SL
			if (c.high >= sl) {
				record(r, shortRet(entry, sl * (1 + SLIP)), eq);
				inPos = false; armed = false;
			} else if (c.low <= tp * 0.999) {
				record(r, shortRet(entry, tp), eq);
				inPos = false; armed = false;
			} else if (barsHeld >= MAX_BARS) {
				record(r, shortRet(entry, c.close * (1 + SLIP)), eq);
				inPos = false; armed = false;
			}
		}
	}
	if (inPos) record(r, shortRet(entry, candles[candles.length - 1].close), eq);
	r.netReturnPct = (eq.e - 1) * 100;
	return r;
}

// H1: Rejim long (al-bekle): BTC 200-SMA üstüne çıkınca al, altına inince sat (4h, coin bazında BTC rejimiyle)
function simRegimeHold(candles: Candle[], regimeAt: (ts: number) => boolean): SimResult {
	const r = newResult();
	const eq = { e: 1, peak: 1 };
	let inPos = false, entry = 0;

	for (let i = 1; i < candles.length; i++) {
		const c = candles[i];
		const on = regimeAt(c.closeTime);
		if (!inPos && on) {
			entry = c.close * (1 + SLIP);
			inPos = true;
		} else if (inPos && !on) {
			record(r, longRet(entry, c.close * (1 - SLIP)), eq);
			inPos = false;
		}
	}
	if (inPos) record(r, longRet(entry, candles[candles.length - 1].close), eq);
	r.netReturnPct = (eq.e - 1) * 100;
	return r;
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
		if (idx < 0 || Number.isNaN(sma200[idx])) return false;
		return closes[idx] > sma200[idx];
	};
}

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 86400000;

	const btc4h = await fetchAndStore('BTCUSDT', '4h', { startTime: startTime - 40 * 86400000, endTime });
	const regimeAt = buildRegimeIndex(btc4h);

	const c4h = new Map<string, Candle[]>();
	const c1h = new Map<string, Candle[]>();
	for (const coin of COINS) {
		c4h.set(coin, await fetchAndStore(coin, '4h', { startTime, endTime }));
		c1h.set(coin, await fetchAndStore(coin, '1h', { startTime, endTime }));
	}

	console.log(`\n🪽 İKİ KANAT LAB — short bacağı + al-bekle | ${COINS.length} coin | ${DAYS} gün | futures %0.05/yön`);
	console.log(`${'strateji'.padEnd(36)}  işlem    WR      PF  ort.getiri  en kötü DD`);
	console.log('─'.repeat(92));

	const runs: { label: string; fn: (coin: string) => SimResult }[] = [
		{ label: 'S1 Donchian Short (4h)', fn: (coin) => simTrendShort(c4h.get(coin)!) },
		{ label: 'S2 Rally Fade %8→TP%8 SL%8 (1h)', fn: (coin) => simRallyFade(c1h.get(coin)!, 8, 8, 8) },
		{ label: 'S2 Rally Fade %10→TP%10 SL%10 (1h)', fn: (coin) => simRallyFade(c1h.get(coin)!, 10, 10, 10) },
		{ label: 'S2 Rally Fade %5→TP%5 SL%5 (1h)', fn: (coin) => simRallyFade(c1h.get(coin)!, 5, 5, 5) },
		{ label: 'H1 Rejim Long Al-Bekle (4h)', fn: (coin) => simRegimeHold(c4h.get(coin)!, regimeAt) },
	];

	for (const run of runs) {
		let trades = 0, wins = 0, gp = 0, gl = 0, sumRet = 0, worstDD = 0;
		for (const coin of COINS) {
			const r = run.fn(coin);
			trades += r.trades; wins += r.wins; gp += r.gp; gl += r.gl;
			sumRet += r.netReturnPct; worstDD = Math.max(worstDD, r.maxDD);
		}
		const wr = trades > 0 ? (wins / trades) * 100 : 0;
		const pf = gl > 0 ? gp / gl : (gp > 0 ? 99 : 0);
		console.log(
			`${run.label.padEnd(36)} ${String(trades).padStart(6)}  ${wr.toFixed(1).padStart(5)}%  ${pf.toFixed(3).padStart(6)}  ${(sumRet / COINS.length).toFixed(2).padStart(9)}%  ${worstDD.toFixed(2).padStart(9)}%`,
		);
	}

	console.log('\nBitti.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
