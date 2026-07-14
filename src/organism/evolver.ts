// ============================================================================
// ORGANISM — Evolver (Knowledge → Action Bridge)
// ============================================================================
// The missing link. Watches assumption verdicts and experiment results,
// then AUTOMATICALLY:
//   1. Combines surviving assumptions into new experiments
//   2. Promotes winning experiments to "candidate" status
//   3. Kills losing experiments
//   4. Generates new hypotheses from experiment outcomes
//
// This is what makes the organism ALIVE.
// ============================================================================

import { log } from '../core/utils.js';
import type { Assumption } from './types.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ExperimentRunner, type Experiment, type EntryRule, type ExitRule } from './experiment-runner.js';
import { randomUUID } from 'node:crypto';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

// ─── Rules ───────────────────────────────────────────────────────────────────

interface SynthesisRule {
	/** Which assumptions trigger this rule (by id prefix) */
	requires: { id: string; status: 'killed' | 'alive' }[];
	/** What experiment to create */
	create: () => Partial<Experiment>;
}

const SYNTHESIS_RULES: SynthesisRule[] = [
	// "Entry doesn't matter" + "Exit matters" → pure exit-focused experiment
	{
		requires: [
			{ id: 'entry-signal-matters', status: 'killed' },
			{ id: 'exit-beats-entry', status: 'alive' },
		],
		create: () => ({
			name: '[SYNTH] Random Giriş + Agresif Trailing',
			hypothesis: 'Giriş önemsizse, sadece çıkış optimizasyonu yeter',
			entryRule: { type: 'random', probability: 0.08 } as EntryRule,
			exitRule: { type: 'trailing_stop', percent: 0.8 } as ExitRule,
		}),
	},

	// "Coins are correlated" → trade alt when BTC moves
	{
		requires: [
			{ id: 'coins-are-independent', status: 'killed' },
		],
		create: () => ({
			name: '[SYNTH] BTC Liderlik Takibi',
			hypothesis: 'Coinler korelasyonluysa, BTC hareketi altları tahmin eder',
			entryRule: { type: 'on_observation', observationType: 'herd' } as EntryRule,
			exitRule: { type: 'trailing_stop', percent: 1.2 } as ExitRule,
			coins: ['ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
		}),
	},

	// "Trend doesn't exist" → mean reversion
	{
		requires: [
			{ id: 'trend-exists', status: 'killed' },
		],
		create: () => ({
			name: '[SYNTH] Mean Reversion Deneyi',
			hypothesis: 'Trend yoksa, aşırı hareket sonrası geri dönüş olur',
			entryRule: { type: 'on_observation', observationType: 'surprise' } as EntryRule,
			exitRule: { type: 'fixed_candles', n: 8 } as ExitRule,
		}),
	},

	// "Silence before storm" survived → enter after low vol
	{
		requires: [
			{ id: 'silence-before-storm', status: 'alive' },
		],
		create: () => ({
			name: '[SYNTH] Sessizlik Sonrası Giriş',
			hypothesis: 'Düşük volatilite büyük hareket öncesi ise, sessizlikte pozisyon aç',
			entryRule: { type: 'on_observation', observationType: 'silence' } as EntryRule,
			exitRule: { type: 'trailing_stop', percent: 1.5 } as ExitRule,
		}),
	},

	// "Volume spike predicts" survived → enter on volume
	{
		requires: [
			{ id: 'volume-spike-predictive', status: 'alive' },
		],
		create: () => ({
			name: '[SYNTH] Hacim Patlaması Girişi',
			hypothesis: 'Hacim fiyatı tahmin ediyorsa, hacim spike\'ında gir',
			entryRule: { type: 'on_observation', observationType: 'divergence' } as EntryRule,
			exitRule: { type: 'stop_and_target', stopPercent: 1, targetPercent: 2.5 } as ExitRule,
		}),
	},

	// "Whipsaw cycle" survived → fade breakouts
	{
		requires: [
			{ id: 'whipsaw-cycle', status: 'alive' },
		],
		create: () => ({
			name: '[SYNTH] Breakout Fade (Ters Pozisyon)',
			hypothesis: 'Piyasa tuzak yapıyorsa, breakout\'un tersine pozisyon al',
			entryRule: { type: 'on_observation', observationType: 'surprise' } as EntryRule,
			exitRule: { type: 'fixed_candles', n: 6 } as ExitRule,
		}),
	},
];

// ─── Experiment Performance Thresholds ───────────────────────────────────────

const PROMOTE_THRESHOLD = {
	minTrades: 15,
	minWinRate: 52,
	minPnl: 1.0,
};

const KILL_THRESHOLD = {
	minTrades: 15,
	maxDrawdown: 8,
	maxLoss: -5,
};

// ─── Evolver ─────────────────────────────────────────────────────────────────

export class Evolver {
	private synthesizedRules = new Set<string>(); // Track which rules already fired
	private promotedExperiments = new Set<string>();
	private killedExperiments = new Set<string>();

	constructor(
		private graph: KnowledgeGraph,
		private experimentRunner: ExperimentRunner,
	) {
		// Kalıcı alanlardan hafızayı geri yükle — restart sonrası aynı deneyi
		// yeniden terfi ettirme/öldürme/sentezleme döngüsünü engeller.
		for (const exp of experimentRunner.getExperiments()) {
			if (exp.promoted) this.promotedExperiments.add(exp.id);
			if (exp.status === 'failed') this.killedExperiments.add(exp.id);
			if (exp.name.startsWith('[SYNTH]') || exp.name.startsWith('[CROSS]')) {
				// İsim bazlı dedupe zaten addExperiment'te; burada kural anahtarını
				// yeniden türetmek yerine sentezin varlığını isimle işaretliyoruz.
				this.synthesizedRules.add(`name:${exp.name}`);
			}
		}
	}

	/**
	 * Called periodically by the Assumption Killer.
	 * Checks current state and evolves the system.
	 */
	evolve(assumptions: Assumption[]): void {
		this.synthesizeExperiments(assumptions);
		this.evaluateExperiments();
		this.crossPollinate();
	}

	// ─── Phase 2a: Assumption → Experiment Synthesis ──────────────────

	private synthesizeExperiments(assumptions: Assumption[]): void {
		for (const rule of SYNTHESIS_RULES) {
			// Check if all required assumptions have the right status
			const allMet = rule.requires.every(req => {
				const match = assumptions.find(a => a.id.startsWith(req.id) && a.status === req.status);
				return !!match;
			});

			if (!allMet) continue;

			// Create a unique key for this rule
			const ruleKey = rule.requires.map(r => `${r.id}:${r.status}`).join('|');
			if (this.synthesizedRules.has(ruleKey)) continue;
			this.synthesizedRules.add(ruleKey);

			// Create the experiment
			const template = rule.create();
			const experiment: Experiment = {
				id: randomUUID(),
				name: template.name || 'Synthesized Experiment',
				hypothesis: template.hypothesis || '',
				sourceAssumption: rule.requires.map(r => r.id).join('+'),
				entryRule: template.entryRule || { type: 'random', probability: 0.05 },
				exitRule: template.exitRule || { type: 'fixed_candles', n: 10 },
				coins: template.coins || COINS,
				status: 'running',
				startedAt: Date.now(),
				maxDurationHours: 168, // 1 week
				positions: [],
				closedPositions: [],
				stats: {
					totalTrades: 0, wins: 0, losses: 0,
					totalPnlPercent: 0, avgPnlPercent: 0, winRate: 0,
					avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0,
				},
			};

			this.experimentRunner.addExperiment(experiment);

			log('');
			log('════════════════════════════════════════════════════════════');
			log(`🧬 SYNTHESIS: New experiment born from knowledge!`);
			log(`   "${experiment.name}"`);
			log(`   Hypothesis: ${experiment.hypothesis}`);
			log(`   Source: ${experiment.sourceAssumption}`);
			log('════════════════════════════════════════════════════════════');
			log('');

			this.graph.addInsight(
				`Synthesized experiment: "${experiment.name}" from assumptions [${experiment.sourceAssumption}]. Hypothesis: ${experiment.hypothesis}`,
				[],
			);
		}
	}

	// ─── Phase 2b: Evaluate Experiments ───────────────────────────────

	private evaluateExperiments(): void {
		const experiments = this.experimentRunner.getExperiments();

		for (const exp of experiments) {
			if (exp.status !== 'running') continue;
			if (this.promotedExperiments.has(exp.id) || this.killedExperiments.has(exp.id)) continue;

			const { stats } = exp;
			if (stats.totalTrades < PROMOTE_THRESHOLD.minTrades) continue;

			// Check for promotion
			if (
				stats.winRate >= PROMOTE_THRESHOLD.minWinRate &&
				stats.totalPnlPercent >= PROMOTE_THRESHOLD.minPnl
			) {
				this.promotedExperiments.add(exp.id);
				(exp as any).promoted = true; // kalıcılaştır
				this.experimentRunner.persist();

				log('');
				log('════════════════════════════════════════════════════════════');
				log(`⭐ PROMOTED: "${exp.name}"`);
				log(`   ${stats.totalTrades} trades | Win: ${stats.winRate.toFixed(1)}% | PnL: +${stats.totalPnlPercent.toFixed(2)}%`);
				log(`   → Bu deney gerçek para ile test edilmeye ADAY`);
				log('════════════════════════════════════════════════════════════');
				log('');

				this.graph.addInsight(
					`⭐ Experiment PROMOTED: "${exp.name}" — ${stats.totalTrades} trades, ${stats.winRate.toFixed(1)}% win rate, +${stats.totalPnlPercent.toFixed(2)}% PnL. CANDIDATE for real money.`,
					[],
				);
			}

			// Check for kill
			if (
				stats.totalPnlPercent <= KILL_THRESHOLD.maxLoss ||
				stats.maxDrawdownPercent >= KILL_THRESHOLD.maxDrawdown
			) {
				this.killedExperiments.add(exp.id);
				// Öldürülen deney gerçekten DURMALI — eski kod sadece not alıyordu,
				// deney koşmaya devam ediyordu.
				(exp as any).status = 'failed';
				(exp as any).endedAt = Date.now();
				this.experimentRunner.persist();

				log('');
				log(`💀 EXPERIMENT KILLED: "${exp.name}" — PnL: ${stats.totalPnlPercent.toFixed(2)}%, DD: ${stats.maxDrawdownPercent.toFixed(2)}%`);
				log('');

				this.graph.addInsight(
					`Experiment killed: "${exp.name}" — ${stats.totalTrades} trades, ${stats.totalPnlPercent.toFixed(2)}% PnL, ${stats.maxDrawdownPercent.toFixed(2)}% max drawdown. Hypothesis "${exp.hypothesis}" not supported by results.`,
					[],
				);
			}
		}
	}

	// ─── Phase 2c: Cross-Pollinate (winning traits breed) ─────────────

	private crossPollinate(): void {
		const experiments = this.experimentRunner.getExperiments();
		const promoted = experiments.filter(e => this.promotedExperiments.has(e.id));

		if (promoted.length < 2) return;

		// Check if we already cross-pollinated
		const crossKey = promoted.map(e => e.id).sort().join('|');
		if (this.synthesizedRules.has(`cross:${crossKey}`)) return;
		this.synthesizedRules.add(`cross:${crossKey}`);

		// Take the best entry from one and best exit from another
		const sorted = [...promoted].sort((a, b) => b.stats.totalPnlPercent - a.stats.totalPnlPercent);
		const bestEntry = sorted[0];
		const bestExit = sorted.length > 1 ? sorted[1] : sorted[0];

		const child: Experiment = {
			id: randomUUID(),
			name: `[CROSS] ${bestEntry.name.slice(0, 20)} × ${bestExit.name.slice(0, 20)}`,
			hypothesis: `En iyi giriş (${bestEntry.name}) + en iyi çıkış (${bestExit.name}) birleşimi`,
			sourceAssumption: 'cross-pollination',
			entryRule: bestEntry.entryRule,
			exitRule: bestExit.exitRule,
			coins: COINS,
			status: 'running',
			startedAt: Date.now(),
			maxDurationHours: 168,
			positions: [],
			closedPositions: [],
			stats: {
				totalTrades: 0, wins: 0, losses: 0,
				totalPnlPercent: 0, avgPnlPercent: 0, winRate: 0,
				avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0,
			},
		};

		this.experimentRunner.addExperiment(child);

		log('');
		log('════════════════════════════════════════════════════════════');
		log(`🧬 CROSS-POLLINATION: "${child.name}"`);
		log(`   Best entry × best exit = new offspring`);
		log('════════════════════════════════════════════════════════════');
		log('');

		this.graph.addInsight(
			`Cross-pollinated experiment: "${child.name}". Combined best entry from "${bestEntry.name}" with best exit from "${bestExit.name}".`,
			[],
		);
	}

	/** Get evolution stats for dashboard */
	getStats() {
		return {
			synthesizedCount: this.synthesizedRules.size,
			promotedCount: this.promotedExperiments.size,
			killedCount: this.killedExperiments.size,
			promotedIds: [...this.promotedExperiments],
		};
	}
}
