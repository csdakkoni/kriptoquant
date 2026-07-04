// ============================================================================
// KRIPTOQUANT — Multi-Asset Research Types (Sprint 13)
// ============================================================================

import type { TimePeriod } from '../walkforward/data-splitter.js';
import type { WalkForwardMetrics, GeneralizationScore } from '../walkforward/walkforward.js';
import type { ExperimentParams } from '../experiments/runner.js';

export interface MultiAssetOptions {
	readonly coins: string[];
	readonly intervals: string[];
	readonly strategyName: string;
	readonly numWindows?: number;
	readonly trainRatio?: number;
}

export interface RobustnessWeights {
	readonly passRate: number;
	readonly assetSuccess: number;
	readonly sharpe: number;
	readonly drawdownPenalty: number;
}

export interface RobustnessConfig {
	readonly weights: RobustnessWeights;
}

export interface WindowRunResult {
	readonly windowIndex: number;
	readonly bestParams: ExperimentParams;
	readonly trainMetrics: WalkForwardMetrics;
	readonly testMetrics: WalkForwardMetrics;
	readonly generalization: GeneralizationScore;
	readonly trainPeriod: TimePeriod;
	readonly testPeriod: TimePeriod;
	readonly passed: boolean;
}

export interface AssetIntervalResult {
	readonly coin: string;
	readonly interval: string;
	readonly passRate: number; // 0 to 1
	readonly avgTestReturn: number;
	readonly avgSharpe: number;
	readonly avgMaxDrawdown: number;
	readonly passed: boolean;
	readonly windows: WindowRunResult[];
}

export interface CrossAssetSummary {
	readonly strategyName: string;
	readonly robustnessScore: number; // 0 to 100
	readonly overallPassRate: number; // 0 to 1
	readonly assetSuccessRatio: number; // 0 to 1
	readonly avgReturn: number;
	readonly avgSharpe: number;
	readonly avgMaxDrawdown: number;
	readonly results: AssetIntervalResult[];
	readonly gitCommit: string;
	readonly timestamp: string;
}
