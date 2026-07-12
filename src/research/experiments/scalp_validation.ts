// ============================================================================
// KRIPTOQUANT RESEARCH — Bollinger Scalp Canlı Kadro Doğrulama Testi
// ============================================================================
// Amaç: "Hızlı al-sat" adayı bollinger-scalp'ın canlı kadroya girmeyi hak
// edip etmediğini test etmek. Karşılaştırma: klasik üst-bant çıkışlı varyant
// ve random baseline. Filtre pipeline'ı KAPALI çalıştırılır ki backtest,
// canlı motorun davranışına birebir denk gelsin (canlıda filtre yok).
// Maliyetler: %0.10 komisyon + %0.05 slipaj (config/default.json).
// Çalıştır: npx tsx src/research/experiments/scalp_validation.ts
// ============================================================================

import { fetchAndStore } from '../../data/fetcher.js';
import { runBacktest } from '../backtester.js';
import { createBollingerScalpStrategy } from '../strategies/bollinger-scalp/index.js';
import { createRandomStrategy } from '../strategies/random/index.js';
import type { PlatformConfig, RiskConfig, Strategy, StrategyDefaultsConfig } from '../../core/types.js';

import defaultConfig from '../../../config/default.json' with { type: 'json' };
import riskJson from '../../../config/risk.json' with { type: 'json' };

const platformConfig = defaultConfig as unknown as PlatformConfig;
const riskConfig = riskJson as unknown as RiskConfig;

// Canlı motorda sinyal filtresi olmadığı için backtest filtresini etkisizleştir
const passthroughDefaults: StrategyDefaultsConfig = {
	strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
	filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
	confidence: { baseScore: 100, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 },
} as StrategyDefaultsConfig;

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'BNBUSDT', 'XRPUSDT'];
const INTERVAL = '15m';
const DAYS = 180;

interface VariantDef {
	label: string;
	make: () => Strategy;
}

const variants: VariantDef[] = [
	{ label: 'scalp-middle (orta bant çıkış)', make: () => createBollingerScalpStrategy(20, 2, 14, 'middle', 0) },
	{ label: 'scalp-middle + RSI<40', make: () => createBollingerScalpStrategy(20, 2, 14, 'middle', 40) },
	{ label: 'classic-upper (üst bant çıkış)', make: () => createBollingerScalpStrategy(20, 2, 14, 'upper', 0) },
	{ label: 'random baseline', make: () => createRandomStrategy() },
];

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;

	console.log(`\n📊 BOLLINGER SCALP DOĞRULAMA — ${COINS.length} coin | ${INTERVAL} | ${DAYS} gün`);
	console.log(`   Maliyet: %${platformConfig.commissionPercent} komisyon + %${platformConfig.slippagePercent} slipaj (her yön)\n`);

	// Veriyi bir kez indir
	const candlesByCoin = new Map<string, Awaited<ReturnType<typeof fetchAndStore>>>();
	for (const coin of COINS) {
		process.stdout.write(`  Veri: ${coin} ${INTERVAL}... `);
		const candles = await fetchAndStore(coin, INTERVAL, { startTime, endTime });
		candlesByCoin.set(coin, candles);
		console.log(`${candles.length} mum`);
	}

	for (const variant of variants) {
		let pooledTrades = 0;
		let pooledWins = 0;
		let pooledGrossProfit = 0;
		let pooledGrossLoss = 0;
		let sumReturn = 0;
		let worstDD = 0;
		const perCoin: string[] = [];

		for (const coin of COINS) {
			const candles = candlesByCoin.get(coin)!;
			if (!candles || candles.length < 100) continue;

			const result = runBacktest(variant.make(), candles, platformConfig, riskConfig, coin, passthroughDefaults, {
				simulationsCount: 0,
			});

			pooledTrades += result.totalTrades;
			pooledWins += result.winningTrades;
			for (const t of result.trades) {
				if (t.pnl > 0) pooledGrossProfit += t.pnl;
				else pooledGrossLoss += Math.abs(t.pnl);
			}
			sumReturn += result.totalReturn;
			worstDD = Math.max(worstDD, result.maxDrawdown);

			perCoin.push(
				`    ${coin.padEnd(9)} işlem: ${String(result.totalTrades).padStart(4)} | WR: ${result.winRate.toFixed(1).padStart(5)}% | PF: ${String(result.profitFactor).padStart(6)} | getiri: ${result.totalReturn.toFixed(2).padStart(7)}% | maxDD: ${result.maxDrawdown.toFixed(2).padStart(5)}% | Sharpe: ${result.sharpeRatio}`,
			);
		}

		const pooledWR = pooledTrades > 0 ? (pooledWins / pooledTrades) * 100 : 0;
		const pooledPF = pooledGrossLoss > 0 ? pooledGrossProfit / pooledGrossLoss : 0;
		const tradesPerDay = pooledTrades / DAYS;

		console.log(`\n━━━ ${variant.label} ━━━`);
		for (const line of perCoin) console.log(line);
		console.log(
			`    TOPLAM     işlem: ${String(pooledTrades).padStart(4)} (${tradesPerDay.toFixed(1)}/gün) | WR: ${pooledWR.toFixed(1)}% | PF: ${pooledPF.toFixed(3)} | ort. getiri: ${(sumReturn / COINS.length).toFixed(2)}% | en kötü DD: ${worstDD.toFixed(2)}%`,
		);
	}

	console.log('\nBitti.\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
