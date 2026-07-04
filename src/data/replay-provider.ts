// ============================================================================
// KRIPTOQUANT — Replay Provider (Sprint 12)
// ============================================================================
// Tarihsel mum verilerini canlı yayın gibi teker teker besleyen provider.
// Hem getHistory hem de subscribe/start/stop destekler.
// ============================================================================

import type { Candle } from '../core/types.js';
import type { MarketDataProvider, ReplayOptions } from './provider.js';

export class ReplayProvider implements MarketDataProvider {
	private readonly candles: Candle[];
	private readonly options: Required<ReplayOptions>;
	private readonly listeners: ((candle: Candle) => void)[] = [];
	private currentIndex: number = 0;
	private running: boolean = false;
	private timerId: NodeJS.Timeout | null = null;

	constructor(candles: Candle[], options: ReplayOptions = {}) {
		this.candles = candles;
		this.options = {
			intervalMs: options.intervalMs ?? 0,
			startIndex: options.startIndex ?? 0,
			endIndex: options.endIndex ?? candles.length - 1,
			autoStop: options.autoStop ?? true,
		};
		this.currentIndex = this.options.startIndex;
	}

	async getHistory(coin: string, interval: string): Promise<Candle[]> {
		return this.candles.slice(this.options.startIndex, this.options.endIndex + 1);
	}

	subscribe(callback: (candle: Candle) => void): void {
		this.listeners.push(callback);
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		if (this.options.intervalMs === 0) {
			// Senkron, olabildiğince hızlı besleme
			while (this.running && this.currentIndex <= this.options.endIndex && this.currentIndex < this.candles.length) {
				const candle = this.candles[this.currentIndex];
				this.currentIndex++;
				this.emit(candle);
			}
			if (this.options.autoStop && this.currentIndex > this.options.endIndex) {
				this.stop();
			}
		} else {
			// Asenkron, intervalMs bekleme ile besleme
			this.scheduleNext();
		}
	}

	stop(): void {
		this.running = false;
		if (this.timerId) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}

	private scheduleNext(): void {
		if (!this.running) return;

		if (this.currentIndex > this.options.endIndex || this.currentIndex >= this.candles.length) {
			if (this.options.autoStop) {
				this.stop();
			}
			return;
		}

		const candle = this.candles[this.currentIndex];
		this.currentIndex++;
		this.emit(candle);

		this.timerId = setTimeout(() => {
			this.scheduleNext();
		}, this.options.intervalMs);
	}

	private emit(candle: Candle): void {
		for (const listener of this.listeners) {
			listener(candle);
		}
	}
}
