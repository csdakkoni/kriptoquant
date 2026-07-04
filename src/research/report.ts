// ============================================================================
// KRIPTOQUANT — Report Generator (Sprint 6 — Signal Analytics)
// ============================================================================
// Terminal raporu: metrikler + filter stats + strategy scorecard + equity curve.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BacktestResult, EquityPoint } from '../core/types.js';
import { formatDate, formatPercent, formatUSDT, round } from '../core/utils.js';

const RESULTS_DIR = join(import.meta.dirname, '../../results');

// ─── ASCII Equity Curve ──────────────────────────────────────────────────────

/**
 * Equity curve'ü ASCII grafik olarak terminale çizer.
 * Amaç estetik değil, sermaye eğrisini hızlıca görmektir.
 *
 * @param curve - Equity noktaları
 * @param width - Grafik genişliği (karakter)
 * @param height - Grafik yüksekliği (satır)
 */
function renderEquityCurve(curve: EquityPoint[], width: number = 60, height: number = 15): string {
	if (curve.length === 0) return '  (veri yok)';

	// Curve'ü width noktasına örnekle (downsample)
	const sampled: number[] = [];
	const step = Math.max(1, Math.floor(curve.length / width));
	for (let i = 0; i < curve.length; i += step) {
		sampled.push(curve[i].equity);
	}
	// Son noktayı mutlaka ekle
	if (sampled[sampled.length - 1] !== curve[curve.length - 1].equity) {
		sampled.push(curve[curve.length - 1].equity);
	}

	const min = Math.min(...sampled);
	const max = Math.max(...sampled);
	const range = max - min || 1; // Sıfıra bölme koruması

	const lines: string[] = [];

	// Y ekseni etiketleri ve grafik gövdesi
	for (let row = height - 1; row >= 0; row--) {
		const threshold = min + (range * row) / (height - 1);
		const label = threshold.toFixed(0).padStart(8);
		let line = `  ${label} │`;

		for (let col = 0; col < sampled.length; col++) {
			const normalizedValue = ((sampled[col] - min) / range) * (height - 1);
			if (Math.round(normalizedValue) === row) {
				line += '█';
			} else if (Math.round(normalizedValue) > row) {
				line += '│';
			} else {
				line += ' ';
			}
		}

		lines.push(line);
	}

	// X ekseni
	const xAxis = `  ${''.padStart(8)} └${'─'.repeat(sampled.length)}`;
	lines.push(xAxis);

	// Tarih etiketleri
	const startDate = formatDate(curve[0].timestamp);
	const endDate = formatDate(curve[curve.length - 1].timestamp);
	const dateLine = `  ${''.padStart(9)}${startDate}${''.padStart(Math.max(1, sampled.length - startDate.length - endDate.length))}${endDate}`;
	lines.push(dateLine);

	return lines.join('\n');
}

// ─── Terminal Raporu ─────────────────────────────────────────────────────────

/**
 * Backtest sonuçlarını profesyonel terminal raporu olarak yazdırır.
 */
export function printReport(result: BacktestResult): void {
	const divider = '═'.repeat(64);
	const thinDivider = '─'.repeat(64);

	console.log('');
	console.log(divider);
	console.log('  📊 KRIPTOQUANT — Backtest Raporu');
	console.log(divider);
	console.log('');

	// ── Genel Bilgiler ───────────────────────────────────────────────────
	console.log(`  Strateji      : ${result.strategyName}`);
	console.log(`  Coin          : ${result.coin}`);
	console.log(`  Aralık        : ${result.interval}`);
	console.log(`  Dönem         : ${result.startDate} → ${result.endDate}`);

	// ── Sermaye ──────────────────────────────────────────────────────────
	console.log('');
	console.log(thinDivider);
	console.log('  💰 Sermaye');
	console.log(thinDivider);
	console.log(`  Başlangıç     : ${formatUSDT(result.initialCapital)}`);
	console.log(`  Bitiş         : ${formatUSDT(result.finalCapital)}`);
	console.log(`  Strategy Ret. : ${formatPercent(result.totalReturn)}`);
	console.log(`  Buy & Hold    : ${formatPercent(result.buyAndHoldReturn)}`);
	console.log(`  Alpha         : ${formatPercent(result.alpha)}`);

	// ── Performans Metrikleri ────────────────────────────────────────────
	console.log('');
	console.log(thinDivider);
	console.log('  📈 Performans Metrikleri');
	console.log(thinDivider);
	console.log(`  Trade Count   : ${result.totalTrades}`);
	console.log(`  Winning       : ${result.winningTrades}`);
	console.log(`  Losing        : ${result.losingTrades}`);
	if (result.rejectedSignals > 0) {
		console.log(`  🛡️ Rejected    : ${result.rejectedSignals}`);
	}
	console.log(`  Win Rate      : ${formatPercent(result.winRate)}`);
	console.log(`  Avg Win       : ${formatUSDT(result.avgWin)}`);
	console.log(`  Avg Loss      : ${formatUSDT(result.avgLoss)}`);
	console.log(`  Profit Factor : ${result.profitFactor}`);
	console.log(`  Sharpe Ratio  : ${result.sharpeRatio}`);
	console.log(`  Max Drawdown  : ${formatPercent(-result.maxDrawdown)}`);

	// ── Gelişmiş Analiz Metrikleri ─────────────────────────────────────────
	if (result.analytics) {
		console.log('');
		console.log(thinDivider);
		console.log('  📊 Gelişmiş Analiz Metrikleri');
		console.log(thinDivider);
		console.log(`  Expectancy USDT : ${typeof result.analytics.expectancyUsdt === 'number' ? formatUSDT(result.analytics.expectancyUsdt) : result.analytics.expectancyUsdt}`);
		console.log(`  Expectancy %    : ${typeof result.analytics.expectancyPercent === 'number' ? formatPercent(result.analytics.expectancyPercent) : result.analytics.expectancyPercent}`);
		console.log(`  Expectancy R    : ${result.analytics.expectancyR}`);
		console.log(`  SQN Score       : ${result.analytics.sqn}`);
		console.log(`  Kelly Fraction  : ${typeof result.analytics.kelly === 'number' ? formatPercent(result.analytics.kelly * 100) : result.analytics.kelly}`);
		console.log(`  Exposure Time   : ${formatPercent(result.analytics.exposureTime)}`);
		console.log(`  Capital Usage   : ${formatPercent(result.analytics.capitalUsage)}`);
		console.log(`  Recovery Factor : ${result.analytics.recoveryFactor}`);
		console.log(`  Ulcer Index     : ${result.analytics.ulcerIndex}`);
		console.log(`  MAR Ratio       : ${result.analytics.marRatio}`);
		console.log(`  Gain/Pain Ratio : ${result.analytics.gainPainRatio}`);
	}

	// ── Piyasa Rejimi Analizi ─────────────────────────────────────────────
	if (result.regimeReport && result.regimeReport.stats) {
		console.log('');
		console.log(thinDivider);
		console.log('  🌍 Piyasa Rejimi Analizi (Market Regime Analysis)');
		console.log(thinDivider);
		console.log('  Regime          Coverage    Trades      Win Rate    Total Return    PF    Recommendation');
		console.log(thinDivider);

		for (const stat of result.regimeReport.stats) {
			const keyStr = stat.regimeKey.padEnd(15);
			const covStr = `${stat.datasetCoveragePercent.toFixed(1)}%`.padEnd(11);
			const tradeStr = `${stat.tradeCount} (${stat.tradePercent.toFixed(1)}%)`.padEnd(12);
			const wrStr = `${stat.winRate.toFixed(1)}%`.padEnd(12);
			const retSign = stat.totalReturn > 0 ? '+' : '';
			const retStr = `${retSign}${stat.totalReturn.toFixed(2)}%`.padEnd(15);
			const pfStr = stat.profitFactor === 999 ? 'Infinity'.padEnd(6) : stat.profitFactor.toFixed(2).padEnd(6);
			
			let recStr = '➖ NEUTRAL';
			if (stat.recommendation === 'ENABLE') recStr = '✔ ENABLE';
			if (stat.recommendation === 'DISABLE') recStr = '✖ DISABLE';

			console.log(`  ${keyStr} ${covStr} ${tradeStr} ${wrStr} ${retStr} ${pfStr} ${recStr}`);
		}
	}

	// ── Filter Statistics ──────────────────────────────────────────────
	if (result.filterStats && result.filterStats.rejected > 0) {
		console.log('');
		console.log(thinDivider);
		console.log('  🛡️ Filtre İstatistikleri');
		console.log(thinDivider);
		const fs = result.filterStats;
		const pct = (n: number) => fs.rejected > 0 ? `(${((n / fs.rejected) * 100).toFixed(1)}%)` : '';
		console.log(`  ADX Filter    : ${fs.byFilter.adx} ${pct(fs.byFilter.adx)}`);
		console.log(`  RVOL Filter   : ${fs.byFilter.rvol} ${pct(fs.byFilter.rvol)}`);
		console.log(`  Confidence    : ${fs.byFilter.confidence} ${pct(fs.byFilter.confidence)}`);
		console.log(`  Multiple      : ${fs.byFilter.multiple} ${pct(fs.byFilter.multiple)}`);
	}

	// ── Strategy Scorecard ─────────────────────────────────────────────
	if (result.filterStats) {
		console.log('');
		console.log(thinDivider);
		console.log(`  🏆 Strategy Scorecard — ${result.strategyName.toUpperCase()}`);
		console.log(thinDivider);
		const fs = result.filterStats;
		console.log(`  Signals       : ${fs.totalSignals}`);
		console.log(`  Accepted      : ${fs.accepted}`);
		console.log(`  Rejected      : ${fs.rejected}`);
		console.log(`  Accept Rate   : ${formatPercent(fs.acceptanceRate)}`);
		console.log(`  Trades        : ${result.totalTrades}`);
		console.log(`  Win Rate      : ${formatPercent(result.winRate)}`);
		console.log(`  Profit Factor : ${result.profitFactor}`);
	}

	// ── Equity Curve ─────────────────────────────────────────────────────
	if (result.equityCurve.length > 0) {
		console.log('');
		console.log(thinDivider);
		console.log('  📉 Equity Curve');
		console.log(thinDivider);
		console.log(renderEquityCurve(result.equityCurve));
	}

	// ── Son 5 İşlem ──────────────────────────────────────────────────────
	if (result.trades.length > 0) {
		console.log('');
		console.log(thinDivider);
		console.log('  📋 Son İşlemler (maks. 5)');
		console.log(thinDivider);

		const recentTrades = result.trades.slice(-5);
		for (const trade of recentTrades) {
			const entryDate = formatDate(trade.entryOrder.timestamp);
			const exitDate = formatDate(trade.exitOrder.timestamp);
			const emoji = trade.pnl > 0 ? '🟢' : '🔴';
			const exitShort = trade.exitReason.length > 25
				? `${trade.exitReason.slice(0, 22)}...`
				: trade.exitReason;
			const maeStr = trade.mae !== undefined ? ` (MAE: ${trade.mae.toFixed(1)}%` : '';
			const mfeStr = trade.mfe !== undefined ? `, MFE: ${trade.mfe.toFixed(1)}%)` : '';
			console.log(
				`  ${emoji} ${entryDate} → ${exitDate} | ` +
				`${formatPercent(trade.pnlPercent).padStart(8)} | ` +
				`${exitShort}${maeStr}${mfeStr}`,
			);
		}
	}

	console.log('');
	console.log(divider);
	console.log('');
}

// ─── JSON Export ─────────────────────────────────────────────────────────────

/**
 * Backtest sonuçlarını JSON dosyası olarak kaydeder.
 * Equity curve dahil edilmez (büyük veri, ayrı analiz için).
 *
 * @returns Kaydedilen dosyanın yolu
 */
export function saveReport(result: BacktestResult): string {
	if (!existsSync(RESULTS_DIR)) {
		mkdirSync(RESULTS_DIR, { recursive: true });
	}

	const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
	const fileName = `${result.strategyName}_${result.coin}_${result.interval}_${timestamp}.json`;
	const filePath = join(RESULTS_DIR, fileName);

	// Equity curve ve analyzedSignals'i JSON'dan çıkar (büyük veri)
	const { equityCurve: _ec, analyzedSignals: _as, ...reportWithoutLargeData } = result;
	writeFileSync(filePath, JSON.stringify(reportWithoutLargeData, null, 2), 'utf-8');
	console.log(`  💾 Rapor kaydedildi: ${filePath}`);

	return filePath;
}
