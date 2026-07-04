// ============================================================================
// KRIPTOQUANT — Market Data Provider Interface (Sprint 12)
// ============================================================================
// Tek interface, capability bazlı.
//
// CSVProvider      → getHistory ✔  subscribe ✘
// ReplayProvider   → getHistory ✔  subscribe ✔
// BinanceREST      → getHistory ✔  subscribe ✘
// BinanceWS        → getHistory ✘  subscribe ✔
//
// Execution Engine sadece MarketDataProvider bilir.
// CSV, Replay, REST, WebSocket bilmez.
// ============================================================================

import type { Candle } from '../core/types.js';

/**
 * Market Data Provider — veri kaynağı soyutlaması.
 *
 * Tüm provider'lar bu interface'i implement eder.
 * Desteklenmeyen operasyonlar Error fırlatır.
 */
export interface MarketDataProvider {
	/** Batch: tüm mumları bir seferde döndür. */
	getHistory(coin: string, interval: string): Promise<Candle[]>;

	/** Stream: her yeni mumda callback çağır. */
	subscribe(callback: (candle: Candle) => void): void;

	/** Stream'i başlat. subscribe() sonrası çağrılır. */
	start(): Promise<void>;

	/** Stream'i durdur. */
	stop(): void;
}

/**
 * ReplayProvider seçenekleri.
 */
export interface ReplayOptions {
	/** Mum arası bekleme (ms). Default 0 = anında replay. */
	readonly intervalMs?: number;
	/** Başlangıç index'i (dahil). Default 0. */
	readonly startIndex?: number;
	/** Bitiş index'i (dahil). Default son mum. */
	readonly endIndex?: number;
	/** Son mumdan sonra otomatik dur. Default true. */
	readonly autoStop?: boolean;
}
