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
import { ExperimentRunner } from './experiment-runner.js';
import { Evolver } from './evolver.js';
import { ObservationScoreboard } from './observation-scoreboard.js';
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
	private experimentRunner: ExperimentRunner;
	private evolver: Evolver;
	private scoreboard: ObservationScoreboard;
	private tickCount = 0;
	private observationCount = 0;
	private running = false;

	constructor() {
		this.graph = new KnowledgeGraph();
		this.journal = new ResearchJournal(this.graph);
		this.experimentRunner = new ExperimentRunner(this.graph);
		this.evolver = new Evolver(this.graph, this.experimentRunner);
		this.scoreboard = new ObservationScoreboard();

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

		const expCount = this.experimentRunner.getExperiments().filter(e => e.status === 'running').length;
		log(`[Organism] Watching ${COINS.length} coins on ${INTERVAL}. ${this.observers.length} observers active.`);
		log(`[Organism] ${this.assumptions.length} assumptions loaded. ${expCount} experiments running.`);
		log(`[Organism] Let the falsification begin.`);
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

		// Gözlem Karnesi: yeni gözlemleri kuyruğa al, olgunlaşan ufukları ölç
		try {
			if (observations.length > 0) this.scoreboard.record(observations, this.candleBuffers);
			this.scoreboard.update(this.candleBuffers);
		} catch (err) {
			logError(`[Organism] Scoreboard error: ${err}`);
		}

		// Step 2: Feed observations + data to ALL assumption tests (parallel)
		// İSTATİSTİK NOTU: Testler her mumda çalışırsa aynı 200 mumluk pencere
		// tekrar tekrar ölçülür — 30 "kanıt" aslında ~1 bağımsız ölçümün kopyası
		// olur ve verdiktler sahte örneklem büyüklüğüyle verilir (pseudo-replication).
		// Bu yüzden testler ~4 saatte bir çalışır (10 coin × 16 mum ≈ 160 tick).
		const EVIDENCE_SAMPLING_TICKS = 160;
		if (this.tickCount % EVIDENCE_SAMPLING_TICKS === 0) {
			for (const assumption of this.assumptions) {
				if (assumption.status !== 'testing') continue;
				const test = this.tests.get(assumption.id);
				if (!test) continue;
				try {
					const evidence = test.evaluate(observations, this.candleBuffers);
					for (const e of evidence) {
						(assumption.evidence as Evidence[]).push(e);
					}
					if (evidence.length > 0) {
						const f = assumption.evidence.filter(e => e.supports).length;
						const ag = assumption.evidence.filter(e => !e.supports).length;
						log(`[EVIDENCE] ${assumption.id}: +${f}/-${ag} (${evidence.length} new)`);
					}
					this.checkVerdict(assumption);
				} catch (err) {
					logError(`[Organism] Test ${assumption.id} error: ${err}`);
				}
			}
		}

		// Step 3: Run experiments (paper trading)
		try {
			this.experimentRunner.processTick(this.candleBuffers, observations);
		} catch (err) {
			logError(`[Organism] Experiment runner error: ${err}`);
		}

		// Step 4: Evolve — synthesize new experiments from knowledge
		if (this.tickCount % 20 === 0) {
			try {
				this.evolver.evolve(this.assumptions);
			} catch (err) {
				logError(`[Organism] Evolver error: ${err}`);
			}
		}

		// Step 5: Periodically save state
		if (this.tickCount % 10 === 0) {
			this.saveState();
		}

		// Step 6: Print periodic status
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

			// Evolution: death creates new life
			this.evolve(assumption);
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
		}
	}

	private evolve(killedAssumption: Assumption): void {
		// When an assumption dies, new questions are born
		const newAssumptions: Assumption[] = [];
		const base = {
			status: 'testing' as const,
			evidence: [],
			createdAt: Date.now(),
			testedWeek: new Date().toISOString().slice(0, 10),
			confidenceToKill: 0.7,
		};

		switch (killedAssumption.id) {
			case 'trend-exists':
				newAssumptions.push({
					...base, id: `mean-reversion-${Date.now()}`,
					statement: 'Fiyat ortalamaya döner (mean reversion)',
					nullHypothesis: 'Fiyat rastgele yürür',
					testMethod: 'Aşırı sapma sonrası dönüş oranı',
				});
				break;
			case 'coins-are-independent':
				newAssumptions.push({
					...base, id: `btc-leads-alts-${Date.now()}`,
					statement: 'BTC altcoinlerden önce hareket eder',
					nullHypothesis: 'Lider-takipçi ilişkisi yoktur',
					testMethod: 'Çapraz korelasyon lag analizi',
				});
				break;
			case 'entry-signal-matters':
				newAssumptions.push({
					...base, id: `position-sizing-matters-${Date.now()}`,
					statement: 'Pozisyon boyutu girişten daha önemlidir',
					nullHypothesis: 'Sabit vs değişken pozisyon boyutu aynı sonucu verir',
					testMethod: 'Volatiliteye göre boyut vs sabit boyut karşılaştırması',
				});
				break;
		}

		// Always generate a random mutation
		const mutations = [
			{ id: `weekend-different-${Date.now()}`, statement: 'Hafta sonu piyasa tamamen farklı davranır', nullHypothesis: 'Hafta içi ve sonu arasında fark yoktur', testMethod: 'Hafta sonu vs hafta içi return dağılımı karşılaştırması' },
			{ id: `night-moves-${Date.now()}`, statement: 'Gece saatlerinde fiyat daha öngörülebilirdir', nullHypothesis: 'Saat dilimi getiriyi etkilemez', testMethod: 'UTC 0-8 vs 8-16 vs 16-24 return karşılaştırması' },
			{ id: `volatility-clusters-${Date.now()}`, statement: 'Volatilite kümelenir (yüksek vol daha yüksek vol getirir)', nullHypothesis: 'Volatilite rastgeledir', testMethod: 'Volatilite otokorelasyonu' },
			{ id: `big-move-reversal-${Date.now()}`, statement: 'Büyük hareketler ertesi gün tersine döner', nullHypothesis: 'Büyük hareket sonrası yön rastgeledir', testMethod: '>2σ hareket sonrası forward return analizi' },
			{ id: `volume-predicts-${Date.now()}`, statement: 'Hacim fiyattan önce hareket eder', nullHypothesis: 'Hacim ve fiyat eş zamanlıdır', testMethod: 'Hacim-fiyat çapraz korelasyon lag testi' },
		];
		const mutation = mutations[Math.floor(Math.random() * mutations.length)];
		newAssumptions.push({ ...base, ...mutation });

		for (const a of newAssumptions) {
			this.assumptions.push(a);
			log(`[EVOLUTION] 🧬 New assumption born: "${a.statement}"`);
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

		// Default assumptions — ALL start as 'testing' (parallel)
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
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'entry-signal-matters',
				statement: 'Giriş sinyali işlem sonucunu etkiler',
				nullHypothesis: 'Rastgele giriş, stratejik girişle aynı sonucu verir',
				testMethod: 'Rastgele giriş forward return analizi',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'timeframe-matters',
				statement: '15 dakikalık zaman dilimi anlamlıdır',
				nullHypothesis: 'Davranış tüm zaman dilimlerinde aynıdır',
				testMethod: 'Farklı ölçeklerde otokorelasyon karşılaştırması',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'exit-beats-entry',
				statement: 'Çıkış zamanlaması girişten daha önemlidir',
				nullHypothesis: 'Farklı çıkış kuralları aynı sonucu verir',
				testMethod: 'Sabit giriş ile farklı çıkış kurallarının karşılaştırması',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			// ─── Wild assumptions ─────────────────────────────────────
			{
				id: 'monday-effect',
				statement: 'Pazartesi günleri farklı davranır',
				nullHypothesis: 'Haftanın günü getiriyi etkilemez',
				testMethod: 'Günlere göre return dağılımı karşılaştırması',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'silence-before-storm',
				statement: 'Sessizlik büyük hareketin habercisidir',
				nullHypothesis: 'Düşük volatilite sonrası yön rastgeledir',
				testMethod: 'Volatilite sıkışması sonrası hareket büyüklüğü analizi',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'round-numbers-matter',
				statement: 'Yuvarlak sayılar destek/direnç olarak çalışır',
				nullHypothesis: 'Yuvarlak sayıların etkisi yoktur',
				testMethod: 'Fiyatın yuvarlak sayılara yakınlığı ve tepki analizi',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'volume-spike-predictive',
				statement: 'Hacim patlaması gelecek fiyatı tahmin eder',
				nullHypothesis: 'Hacim ve gelecek fiyat ilişkisizdir',
				testMethod: 'Hacim spike sonrası forward return analizi',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
				confidenceToKill: 0.7,
			},
			{
				id: 'whipsaw-cycle',
				statement: 'Piyasa düzenli olarak tuzak hareketi yapar',
				nullHypothesis: 'Ani tersine dönüşler rastgeledir',
				testMethod: 'Breakout sonrası geri dönüş oranı analizi',
				status: 'testing',
				evidence: [],
				createdAt: Date.now(),
				testedWeek: new Date().toISOString().slice(0, 10),
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

		const experiments = this.experimentRunner.getExperiments();
		const runningExps = experiments.filter(e => e.status === 'running');
		const completedExps = experiments.filter(e => e.status === 'completed');
		const totalTrades = experiments.reduce((s, e) => s + e.stats.totalTrades, 0);

		log('');
		log('┌─ Organism Status ─────────────────────────────────────────┐');
		log(`│ Ticks: ${this.tickCount}  Observations: ${this.observationCount}  Knowledge: ${graphStats.nodes}`);
		log(`│ Assumptions: 🟢${alive} alive  💀${killed} killed  🔬${testing} testing  ⏳${queued} queued`);

		const active = this.assumptions.find(a => a.status === 'testing');
		if (active) {
			const f = active.evidence.filter(e => e.supports).length;
			const ag = active.evidence.filter(e => !e.supports).length;
			log(`│ Active test: "${active.statement}" [+${f} / -${ag}]`);
		}

		log(`│ Experiments: ▶${runningExps.length} running  ✅${completedExps.length} done  📊${totalTrades} trades`);
		for (const exp of runningExps) {
			const open = exp.positions.filter(p => !p.exitPrice).length;
			log(`│   ${exp.name}: ${exp.stats.totalTrades} trades, ${open} open, PnL: ${exp.stats.totalPnlPercent >= 0 ? '+' : ''}${exp.stats.totalPnlPercent.toFixed(2)}%`);
		}
		log('└───────────────────────────────────────────────────────────┘');
		log('');
	}

	/** Get current state for API/dashboard */
	getState() {
		return {
			assumptions: this.assumptions,
			experiments: this.experimentRunner.getExperiments(),
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
