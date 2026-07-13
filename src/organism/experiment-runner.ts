// ============================================================================
// ORGANISM — Experiment Runner
// ============================================================================
// The bridge between KNOWLEDGE and ACTION.
// When the Assumption Killer produces evidence, the Experiment Runner
// tests that knowledge with real paper trades.
//
// Example flow:
//   Assumption "entry doesn't matter" killed →
//   Experiment: random entry + trailing stop vs random entry + fixed exit →
//   Paper trade both for 1 week → Compare → New knowledge
// ============================================================================

import { log, logError } from '../core/utils.js';
import type { MarketTick, Observation } from './types.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE_DIR = join(process.cwd(), 'organism-data');
const EXPERIMENTS_FILE = join(STATE_DIR, 'experiments.json');

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExperimentStatus = 'running' | 'completed' | 'failed';

export type EntryRule =
	| { type: 'random'; probability: number }        // Enter randomly with given probability per candle
	| { type: 'every_n'; n: number }                  // Enter every N candles
	| { type: 'on_observation'; observationType: string } // Enter when observer fires
	| { type: 'price_cross_sma'; period: number }     // Enter on SMA cross
	| { type: 'always_long' };                         // Always be in position

export type ExitRule =
	| { type: 'fixed_candles'; n: number }             // Exit after N candles
	| { type: 'stop_loss'; percent: number }           // Exit on % loss
	| { type: 'take_profit'; percent: number }         // Exit on % gain
	| { type: 'trailing_stop'; percent: number }       // Trailing stop
	| { type: 'stop_and_target'; stopPercent: number; targetPercent: number }; // Both

export interface PaperPosition {
	id: string;
	experimentId: string;
	coin: string;
	side: 'long' | 'short';
	entryPrice: number;
	entryTime: number;
	exitPrice?: number;
	exitTime?: number;
	exitReason?: string;
	pnlPercent?: number;
	candlesSinceEntry: number;
	highSinceEntry: number;
	lowSinceEntry: number;
}

export interface Experiment {
	id: string;
	name: string;
	hypothesis: string;
	sourceAssumption?: string;  // Which assumption spawned this
	entryRule: EntryRule;
	exitRule: ExitRule;
	coins: string[];
	status: ExperimentStatus;
	startedAt: number;
	endedAt?: number;
	maxDurationHours: number;
	positions: PaperPosition[];
	closedPositions: PaperPosition[];
	stats: ExperimentStats;
}

export interface ExperimentStats {
	totalTrades: number;
	wins: number;
	losses: number;
	totalPnlPercent: number;
	avgPnlPercent: number;
	winRate: number;
	avgWinPercent: number;
	avgLossPercent: number;
	maxDrawdownPercent: number;
}

// ─── Default Experiments ─────────────────────────────────────────────────────

export function createDefaultExperiments(): Experiment[] {
	const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
	const base = {
		status: 'running' as ExperimentStatus,
		startedAt: Date.now(),
		maxDurationHours: 168, // 1 week
		positions: [],
		closedPositions: [],
		stats: emptyStats(),
	};

	return [
		{
			...base,
			id: randomUUID(),
			name: 'Random + Fixed Exit (10 candle)',
			hypothesis: 'Rastgele giriş + sabit 10 mum çıkış başabaş olmalı',
			sourceAssumption: 'entry-signal-matters',
			entryRule: { type: 'random', probability: 0.05 },
			exitRule: { type: 'fixed_candles', n: 10 },
			coins,
		},
		{
			...base,
			id: randomUUID(),
			name: 'Random + Trailing Stop (1.5%)',
			hypothesis: 'Rastgele giriş + trailing stop trendlerden faydalanabilir',
			sourceAssumption: 'exit-beats-entry',
			entryRule: { type: 'random', probability: 0.05 },
			exitRule: { type: 'trailing_stop', percent: 1.5 },
			coins,
		},
		{
			...base,
			id: randomUUID(),
			name: 'Random + Stop/Target (1%/2%)',
			hypothesis: '1:2 risk/ödül oranı rastgele girişle bile pozitif olabilir mi?',
			sourceAssumption: 'exit-beats-entry',
			entryRule: { type: 'random', probability: 0.05 },
			exitRule: { type: 'stop_and_target', stopPercent: 1, targetPercent: 2 },
			coins,
		},
		{
			...base,
			id: randomUUID(),
			name: 'Her 4 Saatte Giriş + Trailing Stop',
			hypothesis: 'Sabit zamanlı giriş + trailing stop döngüsel piyasada çalışır mı?',
			sourceAssumption: 'timeframe-matters',
			entryRule: { type: 'every_n', n: 16 }, // 16 x 15min = 4 hours
			exitRule: { type: 'trailing_stop', percent: 1.0 },
			coins,
		},
		{
			...base,
			id: randomUUID(),
			name: 'Gözlem Tetikli Giriş (Divergence)',
			hypothesis: 'Divergence gözlemi gerçek bir sinyal mi yoksa gürültü mü?',
			sourceAssumption: 'trend-exists',
			entryRule: { type: 'on_observation', observationType: 'divergence' },
			exitRule: { type: 'stop_and_target', stopPercent: 1.5, targetPercent: 3 },
			coins,
		},
	];
}

function emptyStats(): ExperimentStats {
	return {
		totalTrades: 0, wins: 0, losses: 0,
		totalPnlPercent: 0, avgPnlPercent: 0, winRate: 0,
		avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0,
	};
}

// ─── Experiment Runner ───────────────────────────────────────────────────────

export class ExperimentRunner {
	private experiments: Experiment[] = [];
	private graph: KnowledgeGraph;
	private tickCount = 0;

	constructor(graph: KnowledgeGraph) {
		this.graph = graph;
		this.load();
	}

	getExperiments(): Experiment[] {
		return this.experiments;
	}

	// ─── Process Tick ─────────────────────────────────────────────────

	processTick(ticks: Map<string, MarketTick[]>, observations: Observation[]): void {
		this.tickCount++;

		for (const exp of this.experiments) {
			if (exp.status !== 'running') continue;

			// Check duration limit
			if (Date.now() - exp.startedAt > exp.maxDurationHours * 60 * 60 * 1000) {
				this.closeExperiment(exp);
				continue;
			}

			for (const coin of exp.coins) {
				const candles = ticks.get(coin);
				if (!candles || candles.length < 2) continue;

				const latest = candles[candles.length - 1];

				// Update open positions
				this.updatePositions(exp, coin, latest);

				// Check entry
				if (!exp.positions.find(p => p.coin === coin && !p.exitPrice)) {
					if (this.shouldEnter(exp, coin, candles, observations)) {
						this.openPosition(exp, coin, latest);
					}
				}
			}
		}

		// Save periodically
		if (this.tickCount % 5 === 0) this.save();
	}

	// ─── Entry Logic ──────────────────────────────────────────────────

	private shouldEnter(exp: Experiment, coin: string, candles: MarketTick[], observations: Observation[]): boolean {
		const rule = exp.entryRule;

		switch (rule.type) {
			case 'random':
				return Math.random() < rule.probability;

			case 'every_n':
				return this.tickCount % rule.n === 0;

			case 'on_observation':
				return observations.some(o =>
					o.type === rule.observationType && o.coins.includes(coin)
				);

			case 'price_cross_sma': {
				if (candles.length < rule.period + 1) return false;
				const sma = candles.slice(-rule.period).reduce((s, c) => s + c.close, 0) / rule.period;
				const prev = candles[candles.length - 2].close;
				const curr = candles[candles.length - 1].close;
				return prev < sma && curr >= sma;
			}

			case 'always_long':
				return true;

			default:
				return false;
		}
	}

	// ─── Position Management ──────────────────────────────────────────

	private openPosition(exp: Experiment, coin: string, tick: MarketTick): void {
		const pos: PaperPosition = {
			id: randomUUID(),
			experimentId: exp.id,
			coin,
			side: 'long',
			entryPrice: tick.close,
			entryTime: tick.timestamp,
			candlesSinceEntry: 0,
			highSinceEntry: tick.close,
			lowSinceEntry: tick.close,
		};
		exp.positions.push(pos);

		log(`[EXPERIMENT] 📈 ${exp.name} | ${coin} LONG @ ${tick.close.toFixed(2)}`);
	}

	private updatePositions(exp: Experiment, coin: string, tick: MarketTick): void {
		const openPos = exp.positions.filter(p => p.coin === coin && !p.exitPrice);

		for (const pos of openPos) {
			pos.candlesSinceEntry++;
			if (tick.high > pos.highSinceEntry) (pos as any).highSinceEntry = tick.high;
			if (tick.low < pos.lowSinceEntry) (pos as any).lowSinceEntry = tick.low;

			const shouldExit = this.checkExit(exp.exitRule, pos, tick);
			if (shouldExit) {
				this.closePosition(exp, pos, tick, shouldExit);
			}
		}
	}

	private checkExit(rule: ExitRule, pos: PaperPosition, tick: MarketTick): string | null {
		const currentPnl = ((tick.close - pos.entryPrice) / pos.entryPrice) * 100;

		switch (rule.type) {
			case 'fixed_candles':
				if (pos.candlesSinceEntry >= rule.n) return 'fixed_exit';
				return null;

			case 'stop_loss':
				if (currentPnl <= -rule.percent) return 'stop_loss';
				return null;

			case 'take_profit':
				if (currentPnl >= rule.percent) return 'take_profit';
				return null;

			case 'trailing_stop': {
				const fromHigh = ((tick.close - pos.highSinceEntry) / pos.highSinceEntry) * 100;
				if (fromHigh <= -rule.percent) return 'trailing_stop';
				return null;
			}

			case 'stop_and_target':
				if (currentPnl <= -rule.stopPercent) return 'stop_loss';
				if (currentPnl >= rule.targetPercent) return 'take_profit';
				return null;

			default:
				return null;
		}
	}

	private closePosition(exp: Experiment, pos: PaperPosition, tick: MarketTick, reason: string): void {
		(pos as any).exitPrice = tick.close;
		(pos as any).exitTime = tick.timestamp;
		(pos as any).exitReason = reason;
		(pos as any).pnlPercent = ((tick.close - pos.entryPrice) / pos.entryPrice) * 100;

		const pnl = pos.pnlPercent!;
		const emoji = pnl >= 0 ? '🟢' : '🔴';
		log(`[EXPERIMENT] ${emoji} ${exp.name} | ${pos.coin} CLOSE @ ${tick.close.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | Reason: ${reason}`);

		// Move to closed
		exp.closedPositions.push({ ...pos });
		exp.positions = exp.positions.filter(p => p.id !== pos.id);

		// Update stats
		this.recalcStats(exp);
	}

	// ─── Stats ────────────────────────────────────────────────────────

	private recalcStats(exp: Experiment): void {
		const closed = exp.closedPositions;
		if (closed.length === 0) { exp.stats = emptyStats(); return; }

		const wins = closed.filter(p => (p.pnlPercent ?? 0) > 0);
		const losses = closed.filter(p => (p.pnlPercent ?? 0) <= 0);
		const totalPnl = closed.reduce((s, p) => s + (p.pnlPercent ?? 0), 0);

		// Max drawdown
		let peak = 0, maxDd = 0, cumulative = 0;
		for (const p of closed) {
			cumulative += (p.pnlPercent ?? 0);
			if (cumulative > peak) peak = cumulative;
			const dd = peak - cumulative;
			if (dd > maxDd) maxDd = dd;
		}

		exp.stats = {
			totalTrades: closed.length,
			wins: wins.length,
			losses: losses.length,
			totalPnlPercent: totalPnl,
			avgPnlPercent: totalPnl / closed.length,
			winRate: (wins.length / closed.length) * 100,
			avgWinPercent: wins.length > 0 ? wins.reduce((s, p) => s + (p.pnlPercent ?? 0), 0) / wins.length : 0,
			avgLossPercent: losses.length > 0 ? losses.reduce((s, p) => s + (p.pnlPercent ?? 0), 0) / losses.length : 0,
			maxDrawdownPercent: maxDd,
		};
	}

	// ─── Experiment Lifecycle ─────────────────────────────────────────

	private closeExperiment(exp: Experiment): void {
		// Close all open positions at market
		(exp as any).status = 'completed';
		(exp as any).endedAt = Date.now();

		log('');
		log('════════════════════════════════════════════════════════════');
		log(`📋 EXPERIMENT COMPLETED: "${exp.name}"`);
		log(`   Hypothesis: ${exp.hypothesis}`);
		log(`   Trades: ${exp.stats.totalTrades} | Win Rate: ${exp.stats.winRate.toFixed(1)}% | Total PnL: ${exp.stats.totalPnlPercent >= 0 ? '+' : ''}${exp.stats.totalPnlPercent.toFixed(2)}%`);
		log('════════════════════════════════════════════════════════════');
		log('');

		// Record in knowledge graph
		this.graph.addInsight(
			`Experiment "${exp.name}" completed. Hypothesis: "${exp.hypothesis}". Result: ${exp.stats.totalTrades} trades, ${exp.stats.winRate.toFixed(1)}% win rate, ${exp.stats.totalPnlPercent >= 0 ? '+' : ''}${exp.stats.totalPnlPercent.toFixed(2)}% total PnL.`,
			[],
		);

		this.save();
	}

	addExperiment(exp: Experiment): void {
		this.experiments.push(exp);
		this.save();
	}

	// ─── Persistence ──────────────────────────────────────────────────

	private load(): void {
		if (existsSync(EXPERIMENTS_FILE)) {
			try {
				this.experiments = JSON.parse(readFileSync(EXPERIMENTS_FILE, 'utf-8'));
				return;
			} catch {}
		}
		// Create defaults
		this.experiments = createDefaultExperiments();
		this.save();
	}

	private save(): void {
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(EXPERIMENTS_FILE, JSON.stringify(this.experiments, null, 2));
	}
}
