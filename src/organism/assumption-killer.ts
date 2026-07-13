// ============================================================================
// ORGANISM — Assumption Killer (Main Engine)
// ============================================================================
// "KriptoQuant is an autonomous falsification engine for financial markets."
//
// This is the heart. It connects to live market data, runs observers,
// feeds evidence to assumption tests, and tries to KILL beliefs.
//
// Every killed assumption produces KNOWLEDGE.
// Knowledge is the real output. Trading is just the experiment.
// ============================================================================

import { WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';
import type { Assumption, AssumptionTest, MarketTick, Observer, Observation, Evidence } from './types.js';
import { DivergenceObserver, SilenceObserver, HerdObserver, SurpriseObserver } from './observers.js';
import { createAllTests } from './assumptions.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ResearchJournal } from './journal.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = join(process.cwd(), 'organism-data');
const STATE_FILE = join(STATE_DIR, 'assumptions-state.json');

const COINS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
	'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT',
];
const INTERVAL = '15m';

export class AssumptionKiller {
	private ws: WebSocket | null = null;
	private candleBuffers: Map<string, MarketTick[]> = new Map();
	private observers: Observer[] = [];
	private tests: Map<string, AssumptionTest> = new Map();
	private assumptions: Assumption[] = [];
	private graph: KnowledgeGraph;
	private journal: ResearchJournal;
	private tickCount = 0;
	private observationCount = 0;
	private running = false;

	constructor() {
		this.graph = new KnowledgeGraph();
		this.journal = new ResearchJournal(this.graph);

		// Initialize observers
		this.observers = [
			new DivergenceObserver(),
			new SilenceObserver(),
			new HerdObserver(),
			new SurpriseObserver(),
		];

		// Initialize assumption tests
		for (const test of createAllTests()) {
			this.tests.set(test.assumptionId, test);
		}

		// Load or create assumptions
		this.loadState();
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	async start(): Promise<void> {
		this.running = true;

		log('');
		log('╔══════════════════════════════════════════════════════════════╗');
		log('║          ASSUMPTION KILLER — Research Organism              ║');
		log('║  "Science progresses by trying to prove itself wrong."     ║');
		log('╚══════════════════════════════════════════════════════════════╝');
		log('');

		this.printStatus();

		// Connect to Binance WebSocket for live data
		this.connectWebSocket();

		// Schedule daily journal
		this.scheduleDailyJournal();

		log(`[Organism] Watching ${COINS.length} coins on ${INTERVAL}. ${this.observers.length} observers active.`);
		log(`[Organism] ${this.assumptions.length} assumptions loaded. Let the falsification begin.`);
	}

	stop(): void {
		this.running = false;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.saveState();
		log('[Organism] Assumption Killer stopped. State saved.');
	}

	// ─── WebSocket ────────────────────────────────────────────────────────

	private connectWebSocket(): void {
		const streams = COINS.map(c => `${c.toLowerCase()}@kline_${INTERVAL}`).join('/');
		const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

		this.ws = new WebSocket(url);

		this.ws.on('open', () => {
			log(`[Organism] Connected to Binance WebSocket (${COINS.length} streams)`);
		});

		this.ws.on('message', (data: Buffer) => {
			try {
				const parsed = JSON.parse(data.toString());
				if (parsed.data?.k) this.handleKline(parsed.data);
			} catch {}
		});

		this.ws.on('close', () => {
			if (this.running) {
				log('[Organism] WebSocket disconnected. Reconnecting in 5s...');
				setTimeout(() => this.connectWebSocket(), 5000);
			}
		});

		this.ws.on('error', (err) => {
			logError(`[Organism] WebSocket error: ${err.message}`);
		});
	}

	private handleKline(data: any): void {
		const k = data.k;
		if (!k.x) return; // Only process closed candles

		const coin = k.s as string;
		const tick: MarketTick = {
			coin,
			timestamp: k.t,
			open: parseFloat(k.o),
			high: parseFloat(k.h),
			low: parseFloat(k.l),
			close: parseFloat(k.c),
			volume: parseFloat(k.v),
			interval: INTERVAL,
		};

		// Add to buffer
		if (!this.candleBuffers.has(coin)) this.candleBuffers.set(coin, []);
		const buffer = this.candleBuffers.get(coin)!;
		buffer.push(tick);

		// Keep last 200 candles per coin
		if (buffer.length > 200) buffer.splice(0, buffer.length - 200);

		this.tickCount++;

		// Run analysis on every candle close
		this.runObservationCycle();
	}

	// ─── Core Cycle ───────────────────────────────────────────────────────

	private runObservationCycle(): void {
		// Step 1: Observers produce observations
		const observations: Observation[] = [];
		for (const observer of this.observers) {
			try {
				const obs = observer.observe(this.candleBuffers);
				observations.push(...obs);
			} catch (err) {
				logError(`[Organism] Observer ${observer.name} error: ${err}`);
			}
		}

		// Log observations
		for (const obs of observations) {
			this.observationCount++;
			this.graph.addObservation(obs);
			log(`[${obs.type.toUpperCase()}] ${obs.description}`);
		}

		// Step 2: Feed observations + data to active assumption tests
		const activeAssumption = this.assumptions.find(a => a.status === 'testing');
		if (activeAssumption) {
			const test = this.tests.get(activeAssumption.id);
			if (test) {
				try {
					const evidence = test.evaluate(observations, this.candleBuffers);
					for (const e of evidence) {
						(activeAssumption.evidence as Evidence[]).push(e);

						const emoji = e.supports ? '🟢' : '🔴';
						log(`[EVIDENCE] ${emoji} ${e.description}`);
					}

					// Check if we have enough evidence to make a verdict
					this.checkVerdict(activeAssumption);
				} catch (err) {
					logError(`[Organism] Test ${activeAssumption.id} error: ${err}`);
				}
			}
		}

		// Step 3: Periodically save state
		if (this.tickCount % 10 === 0) {
			this.saveState();
		}

		// Step 4: Print periodic status
		if (this.tickCount % 50 === 0) {
			this.printStatus();
		}
	}

	private checkVerdict(assumption: Assumption): void {
		const evidence = assumption.evidence;
		if (evidence.length < 20) return; // Need minimum evidence

		const supporting = evidence.filter(e => e.supports);
		const refuting = evidence.filter(e => !e.supports);

		const supportRatio = supporting.length / evidence.length;

		// If >70% of evidence refutes, kill it
		if (refuting.length / evidence.length > 0.7 && evidence.length >= 30) {
			(assumption as any).status = 'killed';
			(assumption as any).killedAt = Date.now();
			(assumption as any).verdict = `KILLED — ${refuting.length}/${evidence.length} evidence points refute this assumption (${(supportRatio * 100).toFixed(0)}% support rate)`;

			log('');
			log('════════════════════════════════════════════════════════════');
			log(`💀 ASSUMPTION KILLED: "${assumption.statement}"`);
			log(`   ${assumption.verdict}`);
			log('════════════════════════════════════════════════════════════');
			log('');

			this.graph.addInsight(
				`Assumption killed: "${assumption.statement}" — ${assumption.verdict}`,
				evidence.slice(-5).map(e => e.observationId).filter((id): id is string => !!id),
			);

			// Activate next assumption
			this.activateNext();
		}

		// If >70% supports after sufficient evidence, assumption survives this round
		if (supportRatio > 0.7 && evidence.length >= 50) {
			(assumption as any).status = 'alive';
			(assumption as any).verdict = `SURVIVED — ${supporting.length}/${evidence.length} evidence points support this assumption`;

			log('');
			log('════════════════════════════════════════════════════════════');
			log(`🟢 ASSUMPTION SURVIVED: "${assumption.statement}"`);
			log(`   ${assumption.verdict}`);
			log('════════════════════════════════════════════════════════════');
			log('');

			this.activateNext();
		}
	}

	private activateNext(): void {
		const next = this.assumptions.find(a => a.status === 'queued');
		if (next) {
			(next as any).status = 'testing';
			(next as any).testedWeek = new Date().toISOString().slice(0, 10);
			log(`[Organism] Now testing: "${next.statement}"`);
		} else {
			log('[Organism] All assumptions have been tested. Add new ones to continue research.');
		}

		this.saveState();
	}

	// ─── State ────────────────────────────────────────────────────────────

	private loadState(): void {
		if (existsSync(STATE_FILE)) {
			try {
				this.assumptions = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
				return;
			} catch {}
		}

		// Default assumptions
		this.assumptions = [
			{
				id: 'trend-exists',
				statement: 'Fiyat trendleri vardır ve tespit edilebilir',
				nullHypothesis: 'Getiriler rastgeledir (otokorelasyon sıfır)',
				testMethod: 'Farklı lag değerlerinde otokorelasyon ölçümü',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'coins-are-independent',
				statement: 'Coinler birbirinden bağımsız hareket eder',
				nullHypothesis: 'Coinler arasında korelasyon yoktur',
				testMethod: 'Canlı Pearson korelasyon matrisi',
				status: 'queued',
				evidence: [],
				createdAt: Date.now(),
				confidenceToKill: 0.7,
			},
			{
				id: 'entry-signal-matters',
				statement: 'Giriş sinyali işlem sonucunu etkiler',
				nullHypothesis: 'Rastgele giriş, stratejik girişle aynı sonucu verir',
				testMethod: 'Rastgele giriş forward return analizi',
				status: 'queued',
				evidence: [],
				createdAt: Date.now(),
				confidenceToKill: 0.7,
			},
			{
				id: 'timeframe-matters',
				statement: '15 dakikalık zaman dilimi anlamlıdır',
				nullHypothesis: 'Davranış tüm zaman dilimlerinde aynıdır',
				testMethod: 'Farklı ölçeklerde otokorelasyon karşılaştırması',
				status: 'queued',
				evidence: [],
				createdAt: Date.now(),
				confidenceToKill: 0.7,
			},
			{
				id: 'exit-beats-entry',
				statement: 'Çıkış zamanlaması girişten daha önemlidir',
				nullHypothesis: 'Farklı çıkış kuralları aynı sonucu verir',
				testMethod: 'Sabit giriş ile farklı çıkış kurallarının karşılaştırması',
				status: 'queued',
				evidence: [],
				createdAt: Date.now(),
				confidenceToKill: 0.7,
			},
		];

		this.saveState();
	}

	private saveState(): void {
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(STATE_FILE, JSON.stringify(this.assumptions, null, 2));
	}

	// ─── Journal ──────────────────────────────────────────────────────────

	private scheduleDailyJournal(): void {
		// Generate journal every 6 hours
		setInterval(() => {
			const entry = this.journal.generateEntry(this.assumptions);
			log(`[Journal] Daily research entry generated. ${entry.observationCount} observations, ${entry.surprises.length} surprises.`);
		}, 6 * 60 * 60 * 1000);

		// Also generate one now
		setTimeout(() => {
			const entry = this.journal.generateEntry(this.assumptions);
			log(`[Journal] Initial research entry generated.`);
		}, 60_000); // 1 minute after start
	}

	// ─── Display ──────────────────────────────────────────────────────────

	private printStatus(): void {
		const graphStats = this.graph.stats();
		const alive = this.assumptions.filter(a => a.status === 'alive').length;
		const killed = this.assumptions.filter(a => a.status === 'killed').length;
		const testing = this.assumptions.filter(a => a.status === 'testing').length;
		const queued = this.assumptions.filter(a => a.status === 'queued').length;

		log('');
		log('┌─ Organism Status ─────────────────────────────────────────┐');
		log(`│ Ticks: ${this.tickCount}  Observations: ${this.observationCount}  Knowledge Nodes: ${graphStats.nodes}`);
		log(`│ Assumptions: 🟢${alive} alive  💀${killed} killed  🔬${testing} testing  ⏳${queued} queued`);

		const active = this.assumptions.find(a => a.status === 'testing');
		if (active) {
			const f = active.evidence.filter(e => e.supports).length;
			const ag = active.evidence.filter(e => !e.supports).length;
			log(`│ Active test: "${active.statement}" [+${f} / -${ag}]`);
		}
		log('└───────────────────────────────────────────────────────────┘');
		log('');
	}

	/** Get current state for API/dashboard */
	getState(): {
		assumptions: Assumption[];
		stats: { ticks: number; observations: number; graphNodes: number };
	} {
		return {
			assumptions: this.assumptions,
			stats: {
				ticks: this.tickCount,
				observations: this.observationCount,
				graphNodes: this.graph.stats().nodes,
			},
		};
	}
}

// ─── Standalone Entry Point ──────────────────────────────────────────────────

export async function startAssumptionKiller(): Promise<AssumptionKiller> {
	const killer = new AssumptionKiller();
	await killer.start();
	return killer;
}
