// ============================================================================
// KRIPTOQUANT — Equity Time-Series Export
// ============================================================================
// Equity curve'ü CSV olarak dışa aktarır.
// Sütunlar: Timestamp (UTC), Equity, Drawdown (%), CurrentReturn (%)
// ============================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BacktestResult } from '../core/types.js';
import { formatDateTime } from '../core/utils.js';

const RESULTS_DIR = join(import.meta.dirname, '../../results');

const EQUITY_CSV_HEADERS = [
	'Timestamp (UTC)',
	'Equity (USDT)',
	'Drawdown (%)',
	'CurrentReturn (%)',
].join(',');

/**
 * Equity curve'ü CSV dosyasına kaydeder.
 *
 * @returns Kaydedilen dosyanın yolu
 */
export function exportEquityCurve(result: BacktestResult): string {
	if (!existsSync(RESULTS_DIR)) {
		mkdirSync(RESULTS_DIR, { recursive: true });
	}

	const rows = result.equityCurve.map((point) =>
		[
			formatDateTime(point.timestamp),
			point.equity,
			point.drawdownPercent,
			point.returnPercent,
		].join(','),
	);

	const csv = [EQUITY_CSV_HEADERS, ...rows].join('\n');

	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const fileName = `equity_${result.strategyName}_${result.coin}_${timestamp}.csv`;
	const filePath = join(RESULTS_DIR, fileName);

	writeFileSync(filePath, csv, 'utf-8');

	return filePath;
}
