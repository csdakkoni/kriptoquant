// ============================================================================
// KRIPTOQUANT — CSV Provider (Sprint 12)
// ============================================================================
// Tarihsel verileri dosyadan veya API fallback'i ile yükleyen BatchProvider.
// MarketDataProvider interface'ini implement eder.
// Stream operasyonlarını desteklemez.
// ============================================================================

import type { Candle } from '../core/types.js';
import { loadCandles } from './store.js';
import { fetchAndStore } from './fetcher.js';
import type { MarketDataProvider } from './provider.js';

export class CSVProvider implements MarketDataProvider {
	async getHistory(coin: string, interval: string): Promise<Candle[]> {
		let candles = loadCandles(coin, interval);
		if (candles.length === 0) {
			candles = await fetchAndStore(coin, interval);
		}
		return candles;
	}

	subscribe(callback: (candle: Candle) => void): void {
		throw new Error('CSVProvider stream aboneliğini (subscribe) desteklemiyor.');
	}

	async start(): Promise<void> {
		throw new Error('CSVProvider stream başlatmayı (start) desteklemiyor.');
	}

	stop(): void {
		throw new Error('CSVProvider stream durdurmayı (stop) desteklemiyor.');
	}
}
