// ============================================================================
// KRIPTOQUANT — Multi-Asset Runner (Orchestration - Sprint 13)
// ============================================================================
// Multi-asset validation sürecini koordine eder.
// Sadece veri yükleme ve Rolling Walk-Forward orkestrasyonu yapar.
// Skor hesaplama, CSV/JSON export veya terminal raporlama yapmaz.
// ============================================================================

import type { PlatformConfig, RiskConfig } from '../../core/types.js';
import { CSVProvider } from '../../data/csv-provider.js';
import { runRollingWalkForward } from '../walkforward/rolling.js';
import type { MultiAssetOptions, AssetIntervalResult, WindowRunResult } from './types.js';
import { log } from '../../core/utils.js';

export async function runMultiAssetResearch(
	options: MultiAssetOptions,
	platformConfig: PlatformConfig,
	riskConfig: RiskConfig,
): Promise<AssetIntervalResult[]> {
	const provider = new CSVProvider();
	const results: AssetIntervalResult[] = [];

	const numWindows = options.numWindows ?? 5;
	const trainRatio = options.trainRatio ?? 0.70;

	for (const coin of options.coins) {
		for (const interval of options.intervals) {
			log(`\n🔍 Çoklu Varlık Analizi: ${coin} - ${interval} için Walk-Forward başlıyor...`);

			try {
				const candles = await provider.getHistory(coin, interval);

				if (candles.length === 0) {
					log(`⚠️  ${coin} ${interval} için veri bulunamadı. Atlattı.`);
					continue;
				}

				const rollingResult = runRollingWalkForward(
					candles,
					platformConfig,
					riskConfig,
					coin,
					interval,
					options.strategyName,
					numWindows,
					trainRatio,
				);

				const windows: WindowRunResult[] = rollingResult.windows.map((w) => ({
					windowIndex: w.windowIndex,
					bestParams: w.bestParams,
					trainMetrics: w.trainMetrics,
					testMetrics: w.testMetrics,
					generalization: w.generalization,
					trainPeriod: w.trainPeriod,
					testPeriod: w.testPeriod,
					passed: w.passed,
				}));

				const passCount = windows.filter((w) => w.passed).length;
				const passRate = passCount / windows.length;
				const testReturns = windows.map((w) => w.testMetrics.totalReturn);
				const testSharpes = windows.map((w) => w.testMetrics.sharpeRatio);
				const testDrawdowns = windows.map((w) => w.testMetrics.maxDrawdown);

				const avgTestReturn = testReturns.reduce((a, b) => a + b, 0) / testReturns.length;
				const avgSharpe = testSharpes.reduce((a, b) => a + b, 0) / testSharpes.length;
				const avgMaxDrawdown = testDrawdowns.reduce((a, b) => a + b, 0) / testDrawdowns.length;

				// Varlık/Aralık bazlı geçiş kararı
				const passed = passRate >= 0.5 && avgTestReturn > 0;

				results.push({
					coin,
					interval,
					passRate,
					avgTestReturn,
					avgSharpe: avgSharpe || 0,
					avgMaxDrawdown: avgMaxDrawdown || 0,
					passed,
					windows,
				});
			} catch (error) {
				log(`⚠️  ${coin} ${interval} analizi sırasında hata oluştu: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	return results;
}
