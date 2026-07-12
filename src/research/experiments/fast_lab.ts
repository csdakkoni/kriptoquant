// ============================================================================
// KRIPTOQUANT RESEARCH — Hızlı Strateji Laboratuvarı (Fast Lab)
// ============================================================================
// scalp_validation/scalp_sweep negatif çıktı. Bu deney iki yeni hipotezi test
// eder:
//  A) BB dokunuş + SABİT ATR kâr hedefi (orta bant gibi kayan hedef değil)
//  B) Momentum patlaması: güçlü mum + hacim spike'ı al, hızlı çık
// Her ikisi de zaman-stoplu (zombi pozisyon yok). Rejim filtreli/filtresiz.
// Çalıştır: npx tsx src/research/experiments/fast_lab.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { runBacktest } from '../backtester.js';
import { bollingerBands, atr, sma, ema } from '../../core/indicators/index.js';
import type { Candle, PlatformConfig, RiskConfig, Signal, Strategy, StrategyDefaultsConfig } from '../../core/types.js';

import defaultConfig from '../../../config/default.json' with { type: 'json' };
import riskJson from '../../../config/risk.json' with { type: 'json' };

const platformConfig = defaultConfig as unknown as PlatformConfig;
const baseRisk = riskJson as unknown as RiskConfig;

const passthroughDefaults: StrategyDefaultsConfig = {
	strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
	filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
	confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 },
} as StrategyDefaultsConfig;

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT', 'XRPUSDT'];
const INTERVAL = '15m';
const DAYS = 365;

// ─── A) BB Dokunuş + Sabit ATR Hedef ────────────────────────────────────────

function createBbAtrTargetStrategy(
	bbMult: number,
	tpAtrMult: number,
	slAtrMult: number,
	maxBars: number,
): Strategy {
	return {
		name: `bb-atr-tp`,
		description: `BB(20,${bbMult}) touch → TP +${tpAtrMult}ATR, SL ${slAtrMult}ATR, max ${maxBars} bar`,
		warmupPeriod: 30,
		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 30) return [];
			const closes = candles.map((c) => c.close);
			const bb = bollingerBands(closes, 20, bbMult);
			const atrValues = atr(candles, 14);

			let inPos = false;
			let entryPrice = 0;
			let entryAtr = 0;
			let barsHeld = 0;

			for (let i = 30; i < candles.length; i++) {
				const c = candles[i];
				const lower = bb.lower[i];
				const atrVal = atrValues[i];
				if (Number.isNaN(lower) || Number.isNaN(atrVal)) continue;

				if (!inPos) {
					if (c.close <= lower) {
						const sl = c.close - slAtrMult * atrVal;
						signals.push({
							timestamp: c.openTime, side: 'BUY', price: c.close, confidence: 0.7,
							reason: `BB touch, TP +${tpAtrMult}ATR`, metadata: { sl, atr: atrVal },
						});
						inPos = true; entryPrice = c.close; entryAtr = atrVal; barsHeld = 0;
					}
				} else {
					barsHeld++;
					// Motor SL'i tetiklediyse iç durumu sıfırla (sinyal üretme)
					if (c.low <= entryPrice - slAtrMult * entryAtr) { inPos = false; continue; }
					const tpLevel = entryPrice + tpAtrMult * entryAtr;
					if (c.close >= tpLevel || barsHeld >= maxBars) {
						signals.push({
							timestamp: c.openTime, side: 'SELL', price: c.close, confidence: 0.7,
							reason: c.close >= tpLevel ? `TP +${tpAtrMult}ATR` : `Time exit ${maxBars} bar`,
						});
						inPos = false;
					}
				}
			}
			return signals;
		},
	} as any;
}

// ─── B) Momentum Patlaması ──────────────────────────────────────────────────

function createMomentumBurstStrategy(
	minRetPct: number, // tek mumda min % artış (ör. 1.2)
	volMult: number, // hacim > volMult * SMA20(hacim)
	slAtrMult: number,
	maxBars: number,
): Strategy {
	return {
		name: `momo-burst`,
		description: `Momentum burst: ret>${minRetPct}% & vol>${volMult}x → EMA9 trail, SL ${slAtrMult}ATR, max ${maxBars} bar`,
		warmupPeriod: 30,
		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 30) return [];
			const closes = candles.map((c) => c.close);
			const volumes = candles.map((c) => c.volume);
			const ema9 = ema(closes, 9);
			const volSma = sma(volumes, 20);
			const atrValues = atr(candles, 14);

			let inPos = false;
			let entryPrice = 0;
			let entryAtr = 0;
			let barsHeld = 0;

			for (let i = 30; i < candles.length; i++) {
				const c = candles[i];
				const prev = candles[i - 1];
				const atrVal = atrValues[i];
				if (Number.isNaN(ema9[i]) || Number.isNaN(volSma[i]) || Number.isNaN(atrVal)) continue;

				if (!inPos) {
					const retPct = ((c.close - prev.close) / prev.close) * 100;
					const volSpike = volSma[i] > 0 && c.volume > volMult * volSma[i];
					if (retPct >= minRetPct && volSpike && c.close > ema9[i]) {
						const sl = c.close - slAtrMult * atrVal;
						signals.push({
							timestamp: c.openTime, side: 'BUY', price: c.close, confidence: 0.7,
							reason: `Momentum burst +${retPct.toFixed(2)}% vol ${(c.volume / volSma[i]).toFixed(1)}x`,
							metadata: { sl, atr: atrVal },
						});
						inPos = true; entryPrice = c.close; entryAtr = atrVal; barsHeld = 0;
					}
				} else {
					barsHeld++;
					if (c.low <= entryPrice - slAtrMult * entryAtr) { inPos = false; continue; }
					// Çıkış: momentum bitti (EMA9 altına kapanış) veya süre doldu
					if (c.close < ema9[i] || barsHeld >= maxBars) {
						signals.push({
							timestamp: c.openTime, side: 'SELL', price: c.close, confidence: 0.7,
							reason: c.close < ema9[i] ? 'EMA9 trail exit' : `Time exit ${maxBars} bar`,
						});
						inPos = false;
					}
				}
			}
			return signals;
		},
	} as any;
}

// ─── Rejim kapısı ───────────────────────────────────────────────────────────

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

function withRegimeGate(strategy: Strategy, isRiskOn: (ts: number) => boolean): Strategy {
	return {
		...strategy,
		evaluate(candles: Candle[]): Signal[] {
			return strategy.evaluate(candles).filter((s: Signal) => s.side !== 'BUY' || isRiskOn(s.timestamp));
		},
	} as Strategy;
}

// ─── Koşum ──────────────────────────────────────────────────────────────────

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

	const btc4h = await fetchAndStore('BTCUSDT', '4h', { startTime: startTime - 40 * 86400000, endTime });
	const isRiskOn = buildRegimeIndex(btc4h);

	const candlesByCoin = new Map<string, Candle[]>();
	for (const coin of COINS) {
		candlesByCoin.set(coin, await fetchAndStore(coin, INTERVAL, { startTime, endTime }));
	}

	interface Combo { label: string; make: () => Strategy; slAtr: number; }
	const combos: Combo[] = [
		{ label: 'A1 BB(2.5) TP+1.5ATR SL3 max96', make: () => createBbAtrTargetStrategy(2.5, 1.5, 3, 96), slAtr: 3 },
		{ label: 'A2 BB(2.5) TP+2ATR   SL3 max96', make: () => createBbAtrTargetStrategy(2.5, 2.0, 3, 96), slAtr: 3 },
		{ label: 'A3 BB(3.0) TP+2ATR   SL3 max96', make: () => createBbAtrTargetStrategy(3.0, 2.0, 3, 96), slAtr: 3 },
		{ label: 'B1 Momo ret1.2 vol2x SL2 max16', make: () => createMomentumBurstStrategy(1.2, 2, 2, 16), slAtr: 2 },
		{ label: 'B2 Momo ret1.8 vol3x SL2 max16', make: () => createMomentumBurstStrategy(1.8, 3, 2, 16), slAtr: 2 },
		{ label: 'B3 Momo ret1.8 vol3x SL3 max32', make: () => createMomentumBurstStrategy(1.8, 3, 3, 32), slAtr: 3 },
	];

	console.log(`\n🧪 FAST LAB — ${COINS.length} coin | ${INTERVAL} | ${DAYS} gün | maliyet %0.10+%0.05/yön`);
	console.log(`${'combo'.padEnd(34)} rejim  işlem  işl/gün    WR      PF   ort.getiri  en kötü DD`);
	console.log('─'.repeat(104));

	for (const combo of combos) {
		for (const gated of [false, true]) {
			const risk: RiskConfig = { ...baseRisk, stopLossAtrMultiplier: combo.slAtr };
			let pooledTrades = 0, pooledWins = 0, gp = 0, gl = 0, sumReturn = 0, worstDD = 0;

			for (const coin of COINS) {
				const candles = candlesByCoin.get(coin)!;
				if (!candles || candles.length < 300) continue;
				let strat = combo.make();
				if (gated) strat = withRegimeGate(strat, isRiskOn);
				const r = runBacktest(strat, candles, platformConfig, risk, coin, passthroughDefaults, { simulationsCount: 0 });
				pooledTrades += r.totalTrades;
				pooledWins += r.winningTrades;
				for (const t of r.trades) { if (t.pnl > 0) gp += t.pnl; else gl += Math.abs(t.pnl); }
				sumReturn += r.totalReturn;
				worstDD = Math.max(worstDD, r.maxDrawdown);
			}

			const wr = pooledTrades > 0 ? (pooledWins / pooledTrades) * 100 : 0;
			const pf = gl > 0 ? gp / gl : 0;
			console.log(
				`${combo.label.padEnd(34)} ${(gated ? 'AÇIK ' : 'KAPALI').padEnd(6)} ${String(pooledTrades).padStart(5)}  ${(pooledTrades / DAYS).toFixed(1).padStart(7)}  ${wr.toFixed(1).padStart(5)}%  ${pf.toFixed(3).padStart(6)}  ${(sumReturn / COINS.length).toFixed(2).padStart(9)}%  ${worstDD.toFixed(2).padStart(9)}%`,
			);
		}
	}

	console.log('\nBitti.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
