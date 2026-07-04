// ============================================================================
// KRIPTOQUANT — Alpha Discovery Types (Sprint 19)
// ============================================================================

import type { StrategyConfig } from '../strategies/factory/types.js';

export type ValidationStage =
	| 'PENDING'
	| 'BACKTEST_FAILED'
	| 'INSUFFICIENT_TRADES'
	| 'MULTI_ASSET_FAILED'
	| 'MONTE_CARLO_FAILED'
	| 'PASSED';

export interface CompositeAlphaScore {
	readonly profitability: number;
	readonly risk: number;
	readonly consistency: number;
	readonly regimeCoverage: number;
	readonly robustness: number;
	readonly overall: number;
}

export interface CandidateResult {
	readonly id: string;
	readonly config: StrategyConfig;
	readonly stage: ValidationStage;
	readonly failureReason?: string;
	readonly score?: CompositeAlphaScore;
	readonly totalReturn?: number;
	readonly maxDrawdown?: number;
	readonly sharpeRatio?: number;
	readonly tradeCount?: number;
	readonly riskOfRuinPercent?: number;
}

export interface DiscoveryReport {
	readonly timestamp: string;
	readonly coins: string[];
	readonly totalCandidates: number;
	readonly passedCandidates: number;
	readonly results: CandidateResult[];
	readonly paretoFront: CandidateResult[];
}
