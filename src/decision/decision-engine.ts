// ============================================================================
// KRIPTOQUANT — Decision Engine (Sprint 29)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createEmaCrossStrategy } from '../research/strategies/ema-cross/index.js';
import { createSmaCrossStrategy } from '../research/strategies/sma-cross/index.js';
import { createDonchianBreakoutStrategy } from '../research/strategies/donchian-breakout/index.js';
import { PerformanceDB } from './performance-db.js';
import { ModelRegistry } from '../research/model-registry.js';
import type { Candle, Strategy } from '../core/types.js';

export interface DecisionReason {
	rule: string;
	passed: boolean;
	score: number; // Contribution score (+35, -10, etc.)
}

export interface DecisionOutput {
	consensusScore: number; // 0-100
	signal: 'BUY' | 'SELL' | 'WAIT';
	confidence: number; // 0-100
	reasons: DecisionReason[];
}

export class DecisionEngine {
	private performanceDB: PerformanceDB;
	private baseWeights: Record<string, number> = {};

	constructor() {
		this.performanceDB = new PerformanceDB();
		this.loadBaseWeights();
	}

	private loadBaseWeights() {
		const configPath = join(process.cwd(), 'config', 'decision.json');
		if (existsSync(configPath)) {
			try {
				const raw = readFileSync(configPath, 'utf-8');
				const config = JSON.parse(raw);
				if (config.strategies && Array.isArray(config.strategies)) {
					config.strategies.forEach((s: any) => {
						this.baseWeights[s.name] = s.weight;
					});
				}
			} catch (e) {
				console.error(`Failed to load decision weights: ${e}`);
			}
		}

		if (Object.keys(this.baseWeights).length === 0) {
			this.baseWeights = {
				'ema-cross': 0.35,
				'donchian-breakout': 0.45,
				'sma-cross': 0.20,
			};
		}
	}

	public evaluateConsensus(coin: string, candles: Candle[]): DecisionOutput {
		if (candles.length < 50) {
			return { consensusScore: 0, signal: 'WAIT', confidence: 0, reasons: [] };
		}

		// Model Governance Check: Only run strategies/models that are marked 'LIVE' in ModelRegistry
		const modelRegistry = new ModelRegistry();
		const liveModels = modelRegistry.getActiveLiveModels();
		const liveModelNames = liveModels.map(m => m.name);

		// Dynamic Strategy Registry
		const registry: Record<string, Strategy> = {
			'ema-cross': createEmaCrossStrategy(),
			'donchian-breakout': createDonchianBreakoutStrategy(),
			'sma-cross': createSmaCrossStrategy(),
		};

		let buyWeightSum = 0;
		let sellWeightSum = 0;
		const reasons: DecisionReason[] = [];

		const hasActiveStrategy = Object.keys(registry).some(name => liveModelNames.includes(name));
		const lastCandle = candles[candles.length - 1];

		for (const name of Object.keys(registry)) {
			// Skip any strategy that is not actively registered as LIVE under governance rules
			if (liveModelNames.length > 0 && hasActiveStrategy && !liveModelNames.includes(name)) {
				continue;
			}

			const strategy = registry[name];
			const signals = strategy.evaluate(candles);
			
			// 1) Get Strategy performance stats dynamically
			const stats = this.performanceDB.getStrategyStats(name);
			
			// Clamp metrics to standard financial bounds to prevent outlier distortion
			const expectancy = Math.max(-2.0, Math.min(2.0, stats.expectancy));
			const sharpe = Math.max(-3.0, Math.min(3.0, stats.sharpeRatio));
			const maxDrawdown = Math.max(0.0, Math.min(0.95, stats.maxDrawdown));

			// 2) Compute Expectancy-based weight
			let dynamicWeight = expectancy * sharpe * (1 - maxDrawdown);
			
			// Clamp weight to safe range [0.05, 1.00]
			dynamicWeight = Math.max(0.05, Math.min(1.00, dynamicWeight));
			
			// Normalize to roughly match sum ~ 1.0 (relative to baseline)
			const baseW = this.baseWeights[name] ?? 0.33;
			const weight = (dynamicWeight + baseW) / 2.0;

			// Look for the last signal close to recent candles
			const lastSignal = signals.find(s => s.timestamp === lastCandle.openTime);

			if (lastSignal && lastSignal.side === 'BUY') {
				buyWeightSum += weight;
				reasons.push({ rule: `${strategy.name}`, passed: true, score: Math.round(weight * 100) });
			} else if (lastSignal && lastSignal.side === 'SELL') {
				sellWeightSum += weight;
				reasons.push({ rule: `${strategy.name}`, passed: true, score: -Math.round(weight * 100) });
			} else {
				reasons.push({ rule: `${strategy.name}`, passed: false, score: 0 });
			}
		}

		let signal: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
		let confidence = 0;

		if (buyWeightSum > Math.abs(sellWeightSum)) {
			signal = 'BUY';
			confidence = Math.min(100, Math.round(buyWeightSum * 100));
		} else if (Math.abs(sellWeightSum) > buyWeightSum) {
			signal = 'SELL';
			confidence = Math.min(100, Math.round(Math.abs(sellWeightSum) * 100));
		} else {
			signal = 'WAIT';
			confidence = 0;
		}

		console.log(`[Consensus Engine] Evaluating ${coin}:`);
		console.log(`  - Combined Score: BUY = ${buyWeightSum.toFixed(2)}, SELL = ${sellWeightSum.toFixed(2)}`);
		console.log(`  - Result: ${signal} (Confidence: ${confidence}%)`);

		const consensusScore = confidence;

		return {
			consensusScore,
			signal,
			confidence,
			reasons,
		};
	}
}
