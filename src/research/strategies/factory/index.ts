// ============================================================================
// KRIPTOQUANT — Strategy Factory (Sprint 16)
// ============================================================================
// JSON formatındaki lego parçalarını birleştirerek CompiledStrategy üretir.
// ============================================================================

import type { Candle, Signal, Strategy } from '../../../core/types.js';
import type { StrategyConfig, CompiledStrategy } from './types.js';
import { evaluateCondition } from './evaluator.js';
import {
	ema,
	sma,
	rsi,
	macd,
	donchianChannel,
	atr,
	supertrend,
} from '../../../core/indicators/index.js';

export function createStrategyFromConfig(config: StrategyConfig, candles: Candle[]): CompiledStrategy {
	const indicatorsData = new Map<string, any>();
	const closes = candles.map((c) => c.close);

	// 1) Tüm tanımlı indikatörleri tek seferde hesapla ve önbelleğe al
	for (const ind of config.indicators) {
		switch (ind.type) {
			case 'ema': {
				const period = ind.params[0] ?? 20;
				indicatorsData.set(ind.id, ema(closes, period));
				break;
			}
			case 'sma': {
				const period = ind.params[0] ?? 20;
				indicatorsData.set(ind.id, sma(closes, period));
				break;
			}
			case 'rsi': {
				const period = ind.params[0] ?? 14;
				indicatorsData.set(ind.id, rsi(closes, period));
				break;
			}
			case 'macd': {
				const fast = ind.params[0] ?? 12;
				const slow = ind.params[1] ?? 26;
				const signal = ind.params[2] ?? 9;
				indicatorsData.set(ind.id, macd(closes, fast, slow, signal));
				break;
			}
			case 'donchian': {
				const period = ind.params[0] ?? 20;
				indicatorsData.set(ind.id, donchianChannel(candles, period));
				break;
			}
			case 'atr': {
				const period = ind.params[0] ?? 14;
				indicatorsData.set(ind.id, atr(candles, period));
				break;
			}
			case 'supertrend': {
				const period = ind.params[0] ?? 10;
				const mult = ind.params[1] ?? 3.0;
				indicatorsData.set(ind.id, supertrend(candles, period, mult));
				break;
			}
			default:
				throw new Error(`Unknown indicator type: ${ind.type}`);
		}
	}

	// 2) Strateji nesnesini inşa et
	const strategy: Strategy = {
		name: config.metadata.name,
		description: `${config.metadata.name} (v${config.metadata.version})`,
		warmupPeriod: config.warmupPeriod,
		version: config.metadata.version,
		tags: config.metadata.tags,

		evaluate(inputCandles: Candle[]): Signal[] {
			const signals: Signal[] = [];

			// Sinyal üretebilmek için kırılım durum takipleri (Opsiyonel)
			let wasEntry = false;
			let wasExit = false;

			for (let i = config.warmupPeriod; i < inputCandles.length; i++) {
				// Filtreleri kontrol et (Tüm filtreler true dönmeli)
				const filtersPassed = config.filters
					? config.filters.every((f) => evaluateCondition(f, i, indicatorsData, inputCandles))
					: true;

				const isEntry = evaluateCondition(config.entry, i, indicatorsData, inputCandles);
				const isExit = evaluateCondition(config.exit, i, indicatorsData, inputCandles);

				// BUY: Filtreler okeyse ve entry koşulu ilk kez tetikleniyorsa (veya crossover)
				if (filtersPassed && isEntry && !wasEntry) {
					signals.push({
						timestamp: inputCandles[i].openTime,
						side: 'BUY',
						price: inputCandles[i].close,
						confidence: 1.0,
						reason: `Strategy Factory entry condition met`,
					});
				}

				// SELL: Exit koşulu tetikleniyorsa
				if (isExit && !wasExit) {
					signals.push({
						timestamp: inputCandles[i].openTime,
						side: 'SELL',
						price: inputCandles[i].close,
						confidence: 1.0,
						reason: `Strategy Factory exit condition met`,
					});
				}

				wasEntry = isEntry;
				wasExit = isExit;
			}

			return signals;
		},
	};

	return {
		strategy,
		config,
		indicatorsData,
	};
}
