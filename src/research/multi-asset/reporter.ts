// ============================================================================
// KRIPTOQUANT — Multi-Asset Grid Reporter & Exporter (Sprint 13)
// ============================================================================
// Sonuçları terminalde grid şeklinde gösterir, JSON ve CSV olarak saklar.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CrossAssetSummary } from './types.js';
import { getRobustnessLabel } from './scoring.js';

export function printMultiAssetReport(summary: CrossAssetSummary): void {
	const divider = '═'.repeat(72);
	const thinDivider = '─'.repeat(72);

	console.log('');
	console.log(divider);
	console.log('  🔬 MULTI-ASSET RESEARCH LAB — Performance Grid');
	console.log(divider);
	console.log('  Asset      Timeframe   Pass Rate   Avg Test Return   Sharpe    Verdict');
	console.log(thinDivider);

	for (const res of summary.results) {
		const assetStr = res.coin.padEnd(10);
		const tfStr = res.interval.padEnd(12);
		const passStr = `${Math.round(res.passRate * res.windows.length)}/${res.windows.length} (${Math.round(res.passRate * 100)}%)`.padEnd(12);
		
		const retSign = res.avgTestReturn > 0 ? '+' : '';
		const retStr = `${retSign}${res.avgTestReturn.toFixed(2)}%`.padEnd(18);
		
		const sharpeStr = res.avgSharpe.toFixed(3).padEnd(10);
		const verdictStr = res.passed ? '🟢 PASSED' : '❌ FAILED';

		console.log(`  ${assetStr} ${tfStr} ${passStr} ${retStr} ${sharpeStr} ${verdictStr}`);
	}

	console.log(thinDivider);
	console.log('  🎯 SUMMARY STATISTICS');
	console.log(thinDivider);
	console.log(`  Overall Window Pass Rate : ${Math.round(summary.overallPassRate * 100)}%`);
	console.log(`  Asset Success Ratio      : ${Math.round(summary.assetSuccessRatio * 100)}%`);
	console.log(`  Avg Test Return          : ${summary.avgReturn > 0 ? '+' : ''}${summary.avgReturn.toFixed(2)}%`);
	console.log(`  Avg Sharpe               : ${summary.avgSharpe.toFixed(3)}`);
	console.log(`  Avg Max Drawdown         : -${summary.avgMaxDrawdown.toFixed(2)}%`);
	console.log('');
	console.log(`  ╔═════════════════════════════════════════════╗`);
	console.log(`  ║  CROSS-ASSET ROBUSTNESS SCORE: ${String(summary.robustnessScore).padStart(3)} / 100  ║`);
	console.log(`  ║  VERDICT: ${getRobustnessLabel(summary.robustnessScore).padEnd(34)} ║`);
	console.log(`  ╚═════════════════════════════════════════════╝`);
	console.log('');
	console.log(`  Strategy  : ${summary.strategyName}`);
	console.log(`  Git Commit: ${summary.gitCommit}`);
	console.log(`  Timestamp : ${summary.timestamp}`);
	console.log(divider);
	console.log('');
}

export function exportMultiAssetCSV(summary: CrossAssetSummary, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const header = ['Coin', 'Interval', 'PassRate', 'AvgTestReturn', 'AvgSharpe', 'AvgMaxDrawdown', 'Passed'].join(',');
	const rows = summary.results.map((res) => [
		res.coin,
		res.interval,
		`${Math.round(res.passRate * res.windows.length)}/${res.windows.length}`,
		res.avgTestReturn,
		res.avgSharpe,
		res.avgMaxDrawdown,
		res.passed ? 'PASSED' : 'FAILED',
	].join(','));

	writeFileSync(filepath, [header, ...rows].join('\n'), 'utf-8');
}

export function exportMultiAssetJSON(summary: CrossAssetSummary, filepath: string): void {
	const dir = dirname(filepath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	writeFileSync(filepath, JSON.stringify(summary, null, 2), 'utf-8');
}
