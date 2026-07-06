// ============================================================================
// KRIPTOQUANT — Portfolio Engine (Sprint 30)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CorrelationMatrix } from './correlation-matrix.js';
import { StressTestingEngine } from './stress-testing.js';
import type { EngineState } from '../live/live-engine.js';
import type { ScreenerState } from './screener.js';

export interface AllocationItem {
	asset: string;
	percentage: number;
}

export interface PortfolioAllocation {
	current: AllocationItem[];
	recommended: AllocationItem[];
}

export class PortfolioEngine {
	private statePath: string;
	private screenerPath: string;
	private correlationMatrix: CorrelationMatrix;
	private stressTesting: StressTestingEngine;

	constructor() {
		this.statePath = join(process.cwd(), 'results', 'live_paper_state.json');
		this.screenerPath = join(process.cwd(), 'results', 'screener_state.json');
		this.correlationMatrix = new CorrelationMatrix();
		this.stressTesting = new StressTestingEngine();
	}

	public getPortfolioAllocations(): PortfolioAllocation {
		let current: AllocationItem[] = [];
		let recommended: AllocationItem[] = [];

		// 1) Compute Current Allocation
		let cash = 10000;
		let equity = 10000;
		const positionsVal: Record<string, number> = {};

		if (existsSync(this.statePath)) {
			try {
				const raw = readFileSync(this.statePath, 'utf-8');
				const state = JSON.parse(raw) as EngineState;
				cash = state.cash ?? 10000;
				equity = state.currentEquity ?? 10000;

				if (state.activePositions && Array.isArray(state.activePositions)) {
					state.activePositions.forEach(p => {
						const posVal = p.quantity * p.currentPrice;
						positionsVal[p.coin] = (positionsVal[p.coin] ?? 0) + posVal;
					});
				}
			} catch {}
		}

		// Build Current Allocation items
		let totalPosPercent = 0;
		Object.keys(positionsVal).forEach(coin => {
			const pct = Math.round((positionsVal[coin] / equity) * 100);
			current.push({ asset: coin.replace('USDT', ''), percentage: pct });
			totalPosPercent += pct;
		});

		const cashPercent = Math.max(0, 100 - totalPosPercent);
		current.push({ asset: 'CASH', percentage: cashPercent });

		// 2) Compute Recommended Allocation mathematically using Half-Kelly criterion, Correlation Shaving & CVaR constraints
		if (existsSync(this.screenerPath)) {
			try {
				const raw = readFileSync(this.screenerPath, 'utf-8');
				const screenerState = JSON.parse(raw) as ScreenerState;

				let recAllocSum = 0;
				const rawRecommended: AllocationItem[] = [];

				if (screenerState.items && Array.isArray(screenerState.items)) {
					const buyItems = screenerState.items.filter(item => item.signal === 'BUY');
					buyItems.forEach(item => {
						const confidence = item.confidence || 0;
						const vol = 0.20; // 20% volatility
						const expectedReturn = (confidence / 100) * 0.10;
						const sharpe = expectedReturn / vol;
						const kelly = (sharpe / vol) * 0.5; // Half-Kelly
						
						let alloc = Math.round(kelly * 100);
						if (alloc > 15) alloc = 15; // cap
						if (alloc < 2) alloc = 2; // threshold

						rawRecommended.push({ asset: item.coin.replace('USDT', ''), percentage: alloc });
					});
				}

				// Mock return correlations between assets (e.g. BTC and ETH are highly correlated 0.90)
				const correlations: Record<string, Record<string, number>> = {
					'BTC': { 'ETH': 0.90, 'SOL': 0.75, 'LINK': 0.65 },
					'ETH': { 'BTC': 0.90, 'SOL': 0.80, 'LINK': 0.70 },
					'SOL': { 'BTC': 0.75, 'ETH': 0.80, 'LINK': 0.60 }
				};

				// Apply Pearson correlation risk shaving
				const shavedRecommended = this.correlationMatrix.applyCorrelationShaving(rawRecommended, correlations);

				// Apply CVaR Expected Shortfall budget constraint
				const cvarConstrained = this.stressTesting.applyCVaRShaving(shavedRecommended, screenerState.cvar95 || 0.05);

				cvarConstrained.forEach(item => {
					if (recAllocSum + item.percentage <= 80) {
						recommended.push(item);
						recAllocSum += item.percentage;
					}
				});

				recommended.push({ asset: 'CASH', percentage: 100 - recAllocSum });
			} catch {}
		}

		if (recommended.length === 0) {
			recommended = [{ asset: 'CASH', percentage: 100 }];
		}

		return {
			current,
			recommended,
		};
	}
}
