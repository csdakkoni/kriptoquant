// ============================================================================
// KRIPTOQUANT — Consensus Ensemble Strategy (Sprint 29)
// ============================================================================
// Birçok farklı stratejinin sinyal kararlarını alan ve performans ağırlıklı
// oylama mekanizmasıyla nihai bir karar (konsensüs) üreten üst-strateji.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import { DecisionEngine } from '../../../decision/decision-engine.js';

export function createConsensusStrategy(): Strategy {
	const decisionEngine = new DecisionEngine();

	return {
		name: 'consensus',
		description: 'Consensus Ensemble (Hybrid Mode)',
		warmupPeriod: 50,
		version: '1.0.0',
		tags: ['ensemble', 'consensus', 'hybrid'],
		supportedRegimes: ['BULL_HIGH', 'BULL_LOW', 'BEAR_HIGH', 'BEAR_LOW'],

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 50) return [];

			let activeSignalSide: 'BUY' | 'SELL' | null = null;

			// Perform multi-strategy consensus evaluation over historical candles
			for (let i = 50; i < candles.length; i++) {
				const subset = candles.slice(0, i + 1);
				
				// Evaluate consensus for the current subset of history
				const decision = decisionEngine.evaluateConsensus('BACKTEST', subset);

				if (decision.signal === 'BUY' && activeSignalSide !== 'BUY') {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'BUY',
						price: candles[i].close,
						confidence: decision.confidence / 100,
						reason: `Consensus BUY (${decision.confidence}%): ` + decision.reasons.filter(r => r.passed && r.score > 0).map(r => r.rule).join(', '),
					});
					activeSignalSide = 'BUY';
				} else if (decision.signal === 'SELL' && activeSignalSide !== 'SELL') {
					signals.push({
						timestamp: candles[i].openTime,
						side: 'SELL',
						price: candles[i].close,
						confidence: decision.confidence / 100,
						reason: `Consensus SELL (${decision.confidence}%): ` + decision.reasons.filter(r => r.passed && r.score < 0).map(r => r.rule).join(', '),
					});
					activeSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
