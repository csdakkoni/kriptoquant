// ============================================================================
// KRIPTOQUANT RESEARCH — Bollinger Scalp Parametre Taraması
// ============================================================================
// scalp_validation.ts'in sonucu: 15m BB(20,2) tüm varyantlarda masraflara
// yeniliyor. Bu tarama daha derin dokunuş (yüksek çarpan), daha geniş SL ve
// 1h zaman dilimini test eder. Buy & hold referansı da yazdırılır.
// Çalıştır: npx tsx src/research/experiments/scalp_sweep.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { runBacktest } from '../backtester.js';
import { createBollingerScalpStrategy } from '../strategies/bollinger-scalp/index.js';
import type { PlatformConfig, RiskConfig, StrategyDefaultsConfig } from '../../core/types.js';

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

interface Combo {
	interval: string;
	days: number;
	mult: number;
	exit: 'middle' | 'upper';
	slAtr: number;
}

const combos: Combo[] = [
	// 15m — daha derin dokunuş + daha geniş stop
	{ interval: '15m', days: 180, mult: 2.5, exit: 'middle', slAtr: 3 },
	{ interval: '15m', days: 180, mult: 2.5, exit: 'upper', slAtr: 3 },
	{ interval: '15m', days: 180, mult: 3.0, exit: 'middle', slAtr: 3 },
	{ interval: '15m', days: 180, mult: 3.0, exit: 'upper', slAtr: 3 },
	// 1h — aynı masraf, daha büyük hareket
	{ interval: '1h', days: 365, mult: 2.0, exit: 'middle', slAtr: 2 },
	{ interval: '1h', days: 365, mult: 2.0, exit: 'upper', slAtr: 2 },
	{ interval: '1h', days: 365, mult: 2.0, exit: 'upper', slAtr: 3 },
	{ interval: '1h', days: 365, mult: 2.5, exit: 'middle', slAtr: 3 },
	{ interval: '1h', days: 365, mult: 2.5, exit: 'upper', slAtr: 3 },
];

async function main() {
	// Veri önbelleği: interval → coin → candles
	const cache = new Map<string, Map<string, Awaited<ReturnType<typeof fetchAndStore>>>>();

	for (const interval of [...new Set(combos.map((c) => c.interval))]) {
		const days = Math.max(...combos.filter((c) => c.interval === interval).map((c) => c.days));
		const endTime = Date.now();
		const startTime = endTime - days * 24 * 60 * 60 * 1000;
		const byCoin = new Map<string, Awaited<ReturnType<typeof fetchAndStore>>>();
		for (const coin of COINS) {
			const candles = await fetchAndStore(coin, interval, { startTime, endTime });
			byCoin.set(coin, candles);
		}
		cache.set(interval, byCoin);
	}

	// Buy & hold referansı
	console.log(`\n📉 BUY & HOLD REFERANSI:`);
	for (const interval of cache.keys()) {
		const byCoin = cache.get(interval)!;
		const parts: string[] = [];
		for (const coin of COINS) {
			const candles = byCoin.get(coin)!;
			const bh = ((candles[candles.length - 1].close - candles[0].open) / candles[0].open) * 100;
			parts.push(`${coin.replace('USDT', '')}: ${bh.toFixed(1)}%`);
		}
		console.log(`  ${interval}: ${parts.join(' | ')}`);
	}

	console.log(`\n${'combo'.padEnd(38)} işlem  işl/gün    WR      PF   ort.getiri  en kötü DD`);
	console.log('─'.repeat(100));

	for (const combo of combos) {
		const byCoin = cache.get(combo.interval)!;
		const risk: RiskConfig = { ...baseRisk, stopLossAtrMultiplier: combo.slAtr };

		let pooledTrades = 0;
		let pooledWins = 0;
		let gp = 0;
		let gl = 0;
		let sumReturn = 0;
		let worstDD = 0;

		for (const coin of COINS) {
			const candles = byCoin.get(coin)!;
			if (!candles || candles.length < 100) continue;
			const strat = createBollingerScalpStrategy(20, combo.mult, 14, combo.exit, 0);
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
		const label = `${combo.interval} BB(20,${combo.mult}) exit=${combo.exit} SL=${combo.slAtr}ATR`;
		console.log(
			`${label.padEnd(38)} ${String(pooledTrades).padStart(5)}  ${(pooledTrades / combo.days).toFixed(1).padStart(7)}  ${wr.toFixed(1).padStart(5)}%  ${pf.toFixed(3).padStart(6)}  ${(sumReturn / COINS.length).toFixed(2).padStart(9)}%  ${worstDD.toFixed(2).padStart(9)}%`,
		);
	}

	console.log('\nBitti.\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
