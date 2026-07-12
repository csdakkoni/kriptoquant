// ============================================================================
// KRIPTOQUANT RESEARCH — Bollinger Scalp + BTC Rejim Filtresi Testi
// ============================================================================
// Canlı motordaki BTC 4h 200-SMA rejim kapısını backtest'e uygular:
// BTC 4h kapanışı 200-SMA altındayken üretilen BUY sinyalleri düşürülür.
// Böylece "canlıda bu strateji gerçekte nasıl davranırdı" sorusu cevaplanır.
// Çalıştır: npx tsx src/research/experiments/scalp_regime_test.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { runBacktest } from '../backtester.js';
import { createBollingerScalpStrategy } from '../strategies/bollinger-scalp/index.js';
import { sma } from '../../core/indicators/index.js';
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
const DAYS = 365;

/** BTC 4h 200-SMA rejim serisi: timestamp → riskOn */
function buildRegimeIndex(btc4h: Candle[]): (ts: number) => boolean {
	const closes = btc4h.map((c) => c.close);
	const sma200 = sma(closes, 200);
	const times = btc4h.map((c) => c.openTime);
	return (ts: number): boolean => {
		// ts'ten önceki son kapanmış 4h mumunun rejimi
		let lo = 0;
		let hi = times.length - 1;
		let idx = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (times[mid] <= ts) {
				idx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (idx < 0 || Number.isNaN(sma200[idx])) return true; // veri yoksa fail-open (canlı ile aynı)
		return closes[idx] > sma200[idx];
	};
}

/** BUY sinyallerini rejim kapısından geçiren strateji sarmalayıcı */
function withRegimeGate(strategy: Strategy, isRiskOn: (ts: number) => boolean): Strategy {
	return {
		...strategy,
		name: `${strategy.name}+regime`,
		evaluate(candles: Candle[]): Signal[] {
			const signals = strategy.evaluate(candles);
			return signals.filter((s: Signal) => s.side !== 'BUY' || isRiskOn(s.timestamp));
		},
	} as Strategy;
}

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

	// BTC 4h rejim verisi (SMA200 ısınması için ekstra 40 gün)
	const btc4h = await fetchAndStore('BTCUSDT', '4h', { startTime: startTime - 40 * 24 * 60 * 60 * 1000, endTime });
	const isRiskOn = buildRegimeIndex(btc4h);

	// Rejim istatistiği
	const testWindow = btc4h.filter((c) => c.openTime >= startTime);
	const riskOnCount = testWindow.filter((c) => isRiskOn(c.closeTime)).length;
	console.log(`\n🚦 BTC REJİM: Son ${DAYS} günün %${((riskOnCount / testWindow.length) * 100).toFixed(1)}'i RISK_ON (BTC > 4h SMA200)`);

	const combos = [
		{ interval: '1h', mult: 2.0, exit: 'middle' as const, slAtr: 2 },
		{ interval: '1h', mult: 2.0, exit: 'upper' as const, slAtr: 2 },
		{ interval: '15m', mult: 2.5, exit: 'middle' as const, slAtr: 3 },
		{ interval: '15m', mult: 3.0, exit: 'middle' as const, slAtr: 3 },
	];

	for (const combo of combos) {
		console.log(`\n━━━ ${combo.interval} BB(20,${combo.mult}) exit=${combo.exit} SL=${combo.slAtr}ATR — REJİM FİLTRELİ vs FİLTRESİZ ━━━`);
		const risk: RiskConfig = { ...baseRisk, stopLossAtrMultiplier: combo.slAtr };

		for (const gated of [false, true]) {
			let pooledTrades = 0;
			let pooledWins = 0;
			let gp = 0;
			let gl = 0;
			let sumReturn = 0;
			let worstDD = 0;

			for (const coin of COINS) {
				const candles = await fetchAndStore(coin, combo.interval, { startTime, endTime });
				if (!candles || candles.length < 300) continue;
				let strat = createBollingerScalpStrategy(20, combo.mult, 14, combo.exit, 0);
				if (gated) strat = withRegimeGate(strat, isRiskOn);
				const result = runBacktest(strat, candles, platformConfig, risk, coin, passthroughDefaults, { simulationsCount: 0 });

				pooledTrades += result.totalTrades;
				pooledWins += result.winningTrades;
				for (const t of result.trades) {
					if (t.pnl > 0) gp += t.pnl;
					else gl += Math.abs(t.pnl);
				}
				sumReturn += result.totalReturn;
				worstDD = Math.max(worstDD, result.maxDrawdown);
			}

			const wr = pooledTrades > 0 ? (pooledWins / pooledTrades) * 100 : 0;
			const pf = gl > 0 ? gp / gl : 0;
			console.log(
				`  ${gated ? 'REJİM FİLTRELİ' : 'FİLTRESİZ     '}  işlem: ${String(pooledTrades).padStart(5)} (${(pooledTrades / DAYS).toFixed(1)}/gün) | WR: ${wr.toFixed(1)}% | PF: ${pf.toFixed(3)} | ort. getiri: ${(sumReturn / COINS.length).toFixed(2)}% | en kötü DD: ${worstDD.toFixed(2)}%`,
			);
		}
	}

	console.log('\nBitti.\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
