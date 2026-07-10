// ============================================================================
// KRIPTOQUANT — Random Walk Baseline Strategy
// ============================================================================
// Bilimsel kontrol grubu (baseline) olarak tamamen rastgele işlem yapar.
// Tekrarlanabilir olması için mum zaman damgasıyla deterministik çalışır.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';

export function createRandomStrategy(): Strategy {
	return {
		name: 'random',
		description: 'Random Walk Baseline (Yazı-Tura)',
		warmupPeriod: 5,

		evaluate(candles: Candle[]): Signal[] {
			const signals: Signal[] = [];
			if (candles.length < 5) return [];

			let lastSignalSide: 'BUY' | 'SELL' | null = null;

			for (let i = 5; i < candles.length; i++) {
				const current = candles[i];

				// Mum zaman damgasından (openTime) deterministik sözde rastgele değer üretimi
				const seed = Math.sin(current.openTime) * 10000;
				const rand = Math.abs(seed - Math.floor(seed));

				// %3 ihtimalle AL, %3 ihtimalle SAT
				const isBuySetup = rand < 0.03;
				const isSellSetup = rand > 0.97;

				if (isBuySetup && lastSignalSide !== 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'BUY',
						price: current.close,
						confidence: 0.50,
						reason: `Random Walk BUY (Yazı-Tura: ${rand.toFixed(4)} < 0.0300)`
					});
					lastSignalSide = 'BUY';
				} else if (isSellSetup && lastSignalSide === 'BUY') {
					signals.push({
						timestamp: current.openTime,
						side: 'SELL',
						price: current.close,
						confidence: 0.50,
						reason: `Random Walk SELL (Yazı-Tura: ${rand.toFixed(4)} > 0.9700)`
					});
					lastSignalSide = 'SELL';
				}
			}

			return signals;
		}
	} as any;
}
