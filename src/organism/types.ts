// ============================================================================
// ORGANISM — Core Types
// ============================================================================
// KriptoQuant is not a trading bot.
// KriptoQuant is an autonomous falsification engine for financial markets.
// ============================================================================

/** An observation is NOT raw data. It's a detected RELATIONSHIP or ANOMALY. */
export interface Observation {
	readonly id: string;
	readonly timestamp: number;
	readonly type: ObservationType;
	readonly description: string;
	readonly confidence: number; // 0-1
	readonly coins: string[];
	readonly relatedData: Record<string, unknown>;
}

export type ObservationType =
	| 'divergence'    // Two things that should move together, didn't
	| 'convergence'   // Two things that shouldn't move together, did
	| 'silence'       // Abnormal lack of movement
	| 'eruption'      // Sudden break from silence
	| 'herd'          // Everything moving in lockstep
	| 'isolation'     // One coin diverging from the herd
	| 'surprise'      // Reality differs from ALL expectations
	| 'echo'          // A pattern repeating from the past
	| 'liquidity_sweep_high' // Upper wick liquidity hunt
	| 'liquidity_sweep_low'  // Lower wick liquidity hunt
	| 'volatility_squeeze'   // Extreme Bollinger squeeze
	| 'anomaly';      // Something that doesn't fit any category

/** Evidence for or against an assumption */
export interface Evidence {
	readonly timestamp: number;
	readonly observationId?: string;
	readonly supports: boolean; // true = supports assumption, false = refutes
	readonly strength: number; // 0-1
	readonly description: string;
	readonly data?: Record<string, unknown>;
}

/** The verdict on an assumption after testing */
export type AssumptionStatus = 'alive' | 'killed' | 'uncertain' | 'testing' | 'queued';

/** An assumption to be tested and potentially killed */
export interface Assumption {
	readonly id: string;
	readonly statement: string;
	readonly nullHypothesis: string; // What we're trying to prove
	readonly testMethod: string;
	readonly status: AssumptionStatus;
	readonly evidence: Evidence[];
	readonly createdAt: number;
	readonly testedWeek?: string;
	readonly killedAt?: number;
	readonly verdict?: string;
	readonly confidenceToKill: number; // 0-1, evidence threshold needed to kill
}

/** A node in the knowledge graph */
export interface KnowledgeNode {
	readonly id: string;
	readonly type: 'observation' | 'assumption' | 'insight' | 'question' | 'experiment';
	readonly content: string;
	readonly timestamp: number;
	readonly connections: string[]; // IDs of related nodes
	readonly metadata: Record<string, unknown>;
}

/** An edge connecting two knowledge nodes */
export interface KnowledgeEdge {
	readonly from: string;
	readonly to: string;
	readonly relation: 'led_to' | 'refuted' | 'supported' | 'related' | 'evolved_from' | 'raised_question';
	readonly timestamp: number;
}

/** Daily research journal entry */
export interface JournalEntry {
	readonly date: string;
	readonly week: string;
	readonly activeAssumption: string;
	readonly observationCount: number;
	readonly evidenceFor: number;
	readonly evidenceAgainst: number;
	readonly surprises: string[];
	readonly insights: string[];
	readonly newQuestions: string[];
	readonly rawNotes: string;
}

/** A candle with all the data we need */
export interface MarketTick {
	readonly coin: string;
	readonly timestamp: number;
	readonly open: number;
	readonly high: number;
	readonly low: number;
	readonly close: number;
	readonly volume: number;
	readonly interval: string;
}

/** Observer interface — relationship detector, not data reader */
export interface Observer {
	readonly name: string;
	readonly description: string;
	/** Process a new batch of market ticks and produce observations */
	observe(ticks: Map<string, MarketTick[]>): Observation[];
}

/** Assumption tester interface */
export interface AssumptionTest {
	readonly assumptionId: string;
	/** Given new observations and market data, produce evidence */
	evaluate(
		observations: Observation[],
		ticks: Map<string, MarketTick[]>,
	): Evidence[];
}

/** Helper to aggregate lower timeframe candles into higher timeframe (e.g. 15m -> 4h) */
export function aggregateCandles(candles: MarketTick[], factor: number): MarketTick[] {
	if (candles.length === 0) return [];
	const result: MarketTick[] = [];
	for (let i = 0; i < candles.length; i += factor) {
		const chunk = candles.slice(i, i + factor);
		const first = chunk[0];
		const last = chunk[chunk.length - 1];
		result.push({
			coin: first.coin,
			timestamp: first.timestamp,
			interval: `${factor}x${first.interval}`,
			open: first.open,
			high: Math.max(...chunk.map(c => c.high)),
			low: Math.min(...chunk.map(c => c.low)),
			close: last.close,
			volume: chunk.reduce((sum, c) => sum + c.volume, 0)
		});
	}
	return result;
}
