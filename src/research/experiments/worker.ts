// ============================================================================
// KRIPTOQUANT — Worker Thread Entry Point
// ============================================================================
// Ana thread'den gelen parametre chunk'ını backtest'e çevirir.
// Sadece worker_threads ile kullanılır, doğrudan çalıştırılmaz.
// ============================================================================

import { parentPort, workerData } from 'node:worker_threads';
import { runExperiment } from './runner.js';
import type { ExperimentParams, ExperimentResult } from './runner.js';
import type { Candle, PlatformConfig, RiskConfig } from '../../core/types.js';

interface WorkerInput {
	candles: Candle[];
	combinations: ExperimentParams[];
	platformConfig: PlatformConfig;
	riskConfig: RiskConfig;
	coin: string;
}

const { candles, combinations, platformConfig, riskConfig, coin } = workerData as WorkerInput;

const results: ExperimentResult[] = [];

for (const params of combinations) {
	results.push(runExperiment(candles, params, platformConfig, riskConfig, coin));
}

parentPort?.postMessage(results);
