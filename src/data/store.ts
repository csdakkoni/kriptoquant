// ============================================================================
// KRIPTOQUANT — Data Store
// ============================================================================
// JSON dosya bazlı veri saklama ve okuma.
// Coin başına ayrı dosya stratejisi — basit, hızlı, KISS.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from '../core/types.js';
import { log } from '../core/utils.js';

const DATA_DIR = join(import.meta.dirname, '../../data');
const RAW_DIR = join(DATA_DIR, 'raw');
const PROCESSED_DIR = join(DATA_DIR, 'processed');

/**
 * Gerekli dizinlerin var olduğundan emin olur.
 */
function ensureDirectories(): void {
	for (const dir of [DATA_DIR, RAW_DIR, PROCESSED_DIR]) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
}

/**
 * Dosya adını oluşturur: BTCUSDT_1d.json
 */
function getFileName(symbol: string, interval: string): string {
	return `${symbol}_${interval}.json`;
}

/**
 * Mum verilerini JSON dosyasına kaydeder.
 *
 * @param symbol - Coin sembolü (ör. "BTCUSDT")
 * @param interval - Mum aralığı (ör. "1d")
 * @param candles - Kaydedilecek mum verileri
 */
export function saveCandles(symbol: string, interval: string, candles: Candle[]): void {
	ensureDirectories();
	const filePath = join(RAW_DIR, getFileName(symbol, interval));
	writeFileSync(filePath, JSON.stringify(candles, null, 2), 'utf-8');
	log(`${symbol} verisi kaydedildi: ${filePath} (${candles.length} mum)`);
}

/**
 * Kaydedilmiş mum verilerini JSON dosyasından okur.
 *
 * @param symbol - Coin sembolü (ör. "BTCUSDT")
 * @param interval - Mum aralığı (ör. "1d")
 * @returns Mum verileri. Dosya yoksa boş dizi döner.
 */
export function loadCandles(symbol: string, interval: string): Candle[] {
	ensureDirectories();
	const filePath = join(RAW_DIR, getFileName(symbol, interval));

	if (!existsSync(filePath)) {
		log(`${symbol} verisi bulunamadı: ${filePath}`);
		return [];
	}

	const raw = readFileSync(filePath, 'utf-8');
	const candles = JSON.parse(raw) as Candle[];
	log(`${symbol} verisi yüklendi: ${candles.length} mum`);
	return candles;
}

/**
 * Belirtilen coin ve aralık için kayıtlı veri olup olmadığını kontrol eder.
 */
export function hasData(symbol: string, interval: string): boolean {
	ensureDirectories();
	const filePath = join(RAW_DIR, getFileName(symbol, interval));
	return existsSync(filePath);
}
