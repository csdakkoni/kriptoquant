// ============================================================================
// KRIPTOQUANT — Trade Journal (CSV Export)
// ============================================================================
// Backtest sonuçlarındaki tüm işlemleri detaylı CSV olarak kaydeder.
// Tüm zaman damgaları UTC standardındadır.
// ============================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BacktestResult } from '../core/types.js';
import { formatDateTime } from '../core/utils.js';

const RESULTS_DIR = join(import.meta.dirname, '../../results');

const CSV_HEADERS = [
	'Asset',
	'Entry Time (UTC)',
	'Exit Time (UTC)',
	'Entry Price',
	'Exit Price',
	'Position Size (USDT)',
	'Commission (USDT)',
	'Gross PnL (USDT)',
	'Net PnL (USDT)',
	'PnL %',
	'ATR at Entry',
	'Exit Reason',
].join(',');

/**
 * Backtest sonucundaki tüm işlemleri CSV dosyasına kaydeder.
 *
 * @returns Kaydedilen dosyanın yolu
 */
export function exportTradeJournal(result: BacktestResult): string {
	if (!existsSync(RESULTS_DIR)) {
		mkdirSync(RESULTS_DIR, { recursive: true });
	}

	const rows = result.trades.map((trade) => {
		return [
			trade.asset,
			formatDateTime(trade.entryOrder.timestamp),
			formatDateTime(trade.exitOrder.timestamp),
			trade.entryOrder.price,
			trade.exitOrder.price,
			trade.positionSize,
			trade.commission,
			trade.grossPnl,
			trade.pnl,
			trade.pnlPercent,
			trade.atrAtEntry,
			`"${trade.exitReason}"`, // CSV'de virgül içerebilir, çift tırnak ile sarmal
		].join(',');
	});

	const csv = [CSV_HEADERS, ...rows].join('\n');

	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const fileName = `journal_${result.strategyName}_${result.coin}_${timestamp}.csv`;
	const filePath = join(RESULTS_DIR, fileName);

	writeFileSync(filePath, csv, 'utf-8');

	return filePath;
}
