// ============================================================================
// KRIPTOQUANT RESEARCH — Dip Harvest Lab (Limit Emirli Sıçrama Hasadı)
// ============================================================================
// Hipotez: Mean reversion'ın masraflara yenilme sebebi MARKET emirle mum
// KAPANIŞINDA girmek (sıçramanın başını kaçırıp fiyat peşinde koşmak).
// Bekleyen LIMIT emir dipteki iğneyi (wick) yakalar: daha iyi giriş fiyatı,
// sıfır slipaj. Bu deney bunu dürüst kurallarla simüle eder:
//  - Limit alış: bir sonraki mumun low'u seviyenin %0.1 ALTINA inerse dolar
//    (sadece değmek yetmez — kuyruk riski için trade-through şartı).
//    Gap-down açılışta açılış fiyatından dolar (daha iyi fiyat).
//  - Limit satış (TP): mumun high'ı hedefin %0.1 üstüne çıkarsa dolar.
//  - Aynı mumda hem SL hem TP vurulursa → ZARAR sayılır (kötümser sıralama).
//  - SL stop-market: stop seviyesinden %0.05 slipajla, taker komisyonla çıkar.
//  - Komisyon: %0.10 her yön (Binance TR maker=taker varsayımı, iyimserlik yok).
// Çalıştır: npx tsx src/research/experiments/dip_harvest_lab.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { bollingerBands, atr, sma } from '../../core/indicators/index.js';
import type { Candle } from '../../core/types.js';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT', 'XRPUSDT'];
const INTERVAL = '15m';
const DAYS = 365;

const FEE = 0.001; // %0.10 her yön
const SLIP = 0.0005; // stop-market slipajı
const TRADE_THROUGH = 0.999; // limit dolum için %0.1 trade-through şartı

interface Combo {
	label: string;
	entryMode: 'bb' | 'atrDip'; // limit seviyesi: alt BB bandı | close - k*ATR
	bbMult: number; // entryMode=bb için bant çarpanı
	atrDip: number; // entryMode=atrDip için k
	tpPct: number; // kâr hedefi % (limit satış)
	slAtr: number; // stop mesafesi (giriş - k*ATR)
	maxBars: number; // zaman stopu
}

const combos: Combo[] = [
	{ label: 'BB(20,2.0) TP+0.8% SL3ATR', entryMode: 'bb', bbMult: 2.0, atrDip: 0, tpPct: 0.8, slAtr: 3, maxBars: 96 },
	{ label: 'BB(20,2.0) TP+1.2% SL3ATR', entryMode: 'bb', bbMult: 2.0, atrDip: 0, tpPct: 1.2, slAtr: 3, maxBars: 96 },
	{ label: 'BB(20,2.5) TP+1.0% SL3ATR', entryMode: 'bb', bbMult: 2.5, atrDip: 0, tpPct: 1.0, slAtr: 3, maxBars: 96 },
	{ label: 'BB(20,2.5) TP+1.5% SL3ATR', entryMode: 'bb', bbMult: 2.5, atrDip: 0, tpPct: 1.5, slAtr: 3, maxBars: 96 },
	{ label: 'ATR dip 1.5 TP+1.0% SL3ATR', entryMode: 'atrDip', bbMult: 0, atrDip: 1.5, tpPct: 1.0, slAtr: 3, maxBars: 96 },
	{ label: 'ATR dip 2.0 TP+1.2% SL3ATR', entryMode: 'atrDip', bbMult: 0, atrDip: 2.0, tpPct: 1.2, slAtr: 3, maxBars: 96 },
	{ label: 'BB(20,2.0) TP+1.0% SL4ATR maxbar192', entryMode: 'bb', bbMult: 2.0, atrDip: 0, tpPct: 1.0, slAtr: 4, maxBars: 192 },
];

interface SimResult {
	trades: number;
	wins: number;
	grossProfit: number; // sermaye oranı olarak birikmiş
	grossLoss: number;
	netReturnPct: number; // %15 pozisyon büyüklüğü ile bileşik kasa getirisi
	maxDD: number;
	tpExits: number;
	slExits: number;
	timeExits: number;
}

function simulate(candles: Candle[], combo: Combo, riskOnAt?: (ts: number) => boolean): SimResult {
	const closes = candles.map((c) => c.close);
	const bb = bollingerBands(closes, 20, combo.bbMult || 2);
	const atrValues = atr(candles, 14);

	const ALLOC = 0.15; // kasa payı — canlı motorla aynı tavan
	let equity = 1.0;
	let peak = 1.0;
	let maxDD = 0;

	let trades = 0, wins = 0, gp = 0, gl = 0, tpExits = 0, slExits = 0, timeExits = 0;

	let pendingLimit: number | null = null; // bu mum boyunca aktif limit alış seviyesi
	let inPos = false;
	let entry = 0, stopLevel = 0, tpLevel = 0, barsHeld = 0;

	for (let i = 30; i < candles.length; i++) {
		const c = candles[i];
		const atrVal = atrValues[i];
		if (Number.isNaN(atrVal) || Number.isNaN(bb.lower[i])) { pendingLimit = null; continue; }

		if (!inPos) {
			// 1) Önceki mumda konulan limit emir bu mumda doldu mu?
			if (pendingLimit !== null) {
				const L = pendingLimit;
				let fillPrice: number | null = null;
				if (c.open <= L) fillPrice = c.open; // gap-down: açılıştan (daha iyi fiyat)
				else if (c.low <= L * TRADE_THROUGH) fillPrice = L; // iğne trade-through

				if (fillPrice !== null) {
					inPos = true;
					entry = fillPrice;
					stopLevel = entry - combo.slAtr * atrVal;
					tpLevel = entry * (1 + combo.tpPct / 100);
					barsHeld = 0;
					// Dolum sonrası aynı mum içinde SL kontrolü (kötümser)
					if (c.low <= stopLevel) {
						const exitPx = stopLevel * (1 - SLIP);
						const ret = (exitPx / entry) * (1 - FEE) / (1 + FEE) - 1;
						equity *= 1 + ret * ALLOC;
						trades++; slExits++;
						if (ret > 0) { wins++; gp += ret; } else gl += Math.abs(ret);
						inPos = false;
					}
				}
			}

			// 2) Yeni limit emri yerleştir (her mum tazelenir)
			if (!inPos) {
				const gateOk = !riskOnAt || riskOnAt(c.closeTime);
				if (gateOk) {
					const level = combo.entryMode === 'bb' ? bb.lower[i] : c.close - combo.atrDip * atrVal;
					// Limit, mevcut fiyatın altında olmalı (anlamlı dip emri)
					pendingLimit = level < c.close ? level : null;
				} else {
					pendingLimit = null;
				}
			} else {
				pendingLimit = null;
			}
		} else {
			barsHeld++;
			let exited = false;
			let ret = 0;

			// Kötümser sıralama: önce SL kontrolü
			if (c.low <= stopLevel) {
				const exitPx = stopLevel * (1 - SLIP);
				ret = (exitPx / entry) * (1 - FEE) / (1 + FEE) - 1;
				slExits++; exited = true;
			} else if (c.high >= tpLevel / TRADE_THROUGH) {
				// TP limit dolumu (trade-through şartı)
				ret = (tpLevel / entry) * (1 - FEE) / (1 + FEE) - 1;
				tpExits++; exited = true;
			} else if (barsHeld >= combo.maxBars) {
				const exitPx = c.close * (1 - SLIP);
				ret = (exitPx / entry) * (1 - FEE) / (1 + FEE) - 1;
				timeExits++; exited = true;
			}

			if (exited) {
				equity *= 1 + ret * ALLOC;
				trades++;
				if (ret > 0) { wins++; gp += ret; } else gl += Math.abs(ret);
				inPos = false;
				pendingLimit = null;
			}
		}

		if (equity > peak) peak = equity;
		const dd = ((peak - equity) / peak) * 100;
		if (dd > maxDD) maxDD = dd;
	}

	return {
		trades, wins,
		grossProfit: gp, grossLoss: gl,
		netReturnPct: (equity - 1) * 100,
		maxDD,
		tpExits, slExits, timeExits,
	};
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

	console.log(`\n🎣 DIP HARVEST LAB — limit emirli iğne dolumu | ${COINS.length} coin | ${INTERVAL} | ${DAYS} gün`);
	console.log(`   Komisyon %0.10/yön, TP/giriş limitlerinde %0.1 trade-through şartı, SL+TP aynı mumda = ZARAR\n`);
	console.log(`${'combo'.padEnd(37)} rejim   işlem işl/gün    WR      PF  ort.getiri  en kötü DD   TP/SL/Time`);
	console.log('─'.repeat(118));

	for (const combo of combos) {
		for (const gated of [false, true]) {
			let trades = 0, wins = 0, gp = 0, gl = 0, sumRet = 0, worstDD = 0;
			let tpE = 0, slE = 0, tiE = 0;

			for (const coin of COINS) {
				const candles = candlesByCoin.get(coin)!;
				if (!candles || candles.length < 300) continue;
				const r = simulate(candles, combo, gated ? isRiskOn : undefined);
				trades += r.trades; wins += r.wins; gp += r.grossProfit; gl += r.grossLoss;
				sumRet += r.netReturnPct;
				worstDD = Math.max(worstDD, r.maxDD);
				tpE += r.tpExits; slE += r.slExits; tiE += r.timeExits;
			}

			const wr = trades > 0 ? (wins / trades) * 100 : 0;
			const pf = gl > 0 ? gp / gl : 0;
			console.log(
				`${combo.label.padEnd(37)} ${(gated ? 'AÇIK ' : 'KAPALI').padEnd(6)} ${String(trades).padStart(6)} ${(trades / DAYS).toFixed(1).padStart(7)}  ${wr.toFixed(1).padStart(5)}%  ${pf.toFixed(3).padStart(6)}  ${(sumRet / COINS.length).toFixed(2).padStart(9)}%  ${worstDD.toFixed(2).padStart(9)}%   ${tpE}/${slE}/${tiE}`,
			);
		}
	}

	console.log('\nBitti.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
