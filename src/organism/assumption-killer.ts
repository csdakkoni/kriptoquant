// ============================================================================
// ORGANISM — Ana döngü
// ============================================================================
// Canlı piyasa verisine bağlanır, gözlemcileri çalıştırır, gözlemleri karneye
// işler, kağıt deneyleri yürütür ve karnenin kanıtından yeni deney doğurur.
//
// 4 Ağu'da VARSAYIM PANOSU kaldırıldı (18 varsayım, ~1400 satır). Gerekçe:
// panonun alım-satıma tek etkisi, verdiktlere bağlı 6 elle yazılmış deney
// kuralıydı ve bunların ikisi kopuktu — biri canlıda hiç üretilmeyen bir
// gözleme bağlıydı, diğerinin adı hacim derken kuralı başka sinyale bakıyordu.
// Yerine geçen mekanizma daha dürüst: deneyler artık yalnızca gözlem karnesinin
// ÖLÇTÜĞÜ kanıttan doğar. Ekranda rakam gösteren ama hiçbir karara dokunmayan
// katman bırakmamak esas kuraldır.
// ============================================================================

import { WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';
import type { MarketTick, Observer, Observation } from './types.js';
import { DivergenceObserver, SilenceObserver, HerdObserver, SurpriseObserver, LiquidityWickObserver, BollingerSqueezeObserver } from './observers.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ExperimentRunner } from './experiment-runner.js';
import { Evolver } from './evolver.js';
import { ObservationScoreboard } from './observation-scoreboard.js';
import { RegimeDetector } from './regime.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Testlerin gerçek durumu ezmemesi için dizin ORGANISM_DATA_DIR ile değiştirilebilir
const STATE_DIR = process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');

const COINS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
	'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT',
];
const INTERVAL = '15m';

export class AssumptionKiller {
	private ws: WebSocket | null = null;
	private candleBuffers: Map<string, MarketTick[]> = new Map();
	private observers: Observer[] = [];
	private graph: KnowledgeGraph;
	private experimentRunner: ExperimentRunner;
	private evolver: Evolver;
	private scoreboard: ObservationScoreboard;
	private regime: RegimeDetector;
	private tickCount = 0;
	private observationCount = 0;
	private running = false;
	// Gözlemciler 15dk'lık period başına BİR kez çalışır (10 coinin her kapanışında değil)
	private lastObservationPeriod = 0;
	// Aynı gözlemin (tip+coin seti) 2 saat içinde tekrar yayınlanmasını engeller
	private obsCooldown = new Map<string, number>();

	constructor() {
		this.graph = new KnowledgeGraph();
		this.experimentRunner = new ExperimentRunner(this.graph);
		this.evolver = new Evolver(this.graph, this.experimentRunner);
		this.scoreboard = new ObservationScoreboard();
		this.regime = new RegimeDetector();
		this.experimentRunner.setRegimeProvider(() => this.regime.getRegime());

		// Initialize observers
		this.observers = [
			new DivergenceObserver(),
			new SilenceObserver(),
			new HerdObserver(),
			new SurpriseObserver(),
			new LiquidityWickObserver(),
			new BollingerSqueezeObserver(),
		];

	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	async start(): Promise<void> {
		this.running = true;

		log('');
		log('╔══════════════════════════════════════════════════════════════╗');
		log('║   KRİPTOQUANT — Ölçüm organizması                            ║');
		log('║   Kanıt olmadan strateji doğmaz.                             ║');
		log('╚══════════════════════════════════════════════════════════════╝');
		log('');

		this.printStatus();

		// KRİTİK: Geçmiş mumları REST'ten yükle. Bu olmadan her restart sonrası
		// tamponlar boş başlar ve organizma saatlerce kör kalır (gözlemciler
		// 10-30, varsayım testleri 50, swing girişleri 192 mum ister).
		await this.bootstrapHistory();

		// Rejim dedektörünü uyandır (ilk fetch'i tetikler; 15dk'da bir tazelenir)
		this.regime.getRegime();

		// Connect to Binance WebSocket for live data
		this.connectWebSocket();

		const expCount = this.experimentRunner.getExperiments().filter(e => e.status === 'running').length;
		log(`[Organism] Watching ${COINS.length} coins on ${INTERVAL}. ${this.observers.length} observers active.`);
		log(`[Organism] ${expCount} deney çalışıyor.`);
	}

	stop(): void {
		this.running = false;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		log('[Organism] Durduruldu.');
	}

	// ─── History Bootstrap ────────────────────────────────────────────────

	private async bootstrapHistory(): Promise<void> {
		log(`[Organism] Geçmiş mumlar yükleniyor (${COINS.length} coin × 200 mum)...`);
		for (const coin of COINS) {
			try {
				const res = await fetch(
					`https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${INTERVAL}&limit=201`,
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as any[];
				// Son eleman hâlâ AÇIK olan mumdur — atılır, yalnızca kapananlar alınır
				const ticks: MarketTick[] = data.slice(0, -1).map((d) => ({
					coin,
					timestamp: Number(d[0]),
					open: parseFloat(d[1]),
					high: parseFloat(d[2]),
					low: parseFloat(d[3]),
					close: parseFloat(d[4]),
					volume: parseFloat(d[5]),
					interval: INTERVAL,
				}));
				this.candleBuffers.set(coin, ticks);
				await new Promise((r) => setTimeout(r, 120)); // rate limit nezaketi
			} catch (err) {
				logError(`[Organism] ${coin} geçmişi yüklenemedi (canlı akıştan dolacak): ${err}`);
			}
		}
		const loaded = [...this.candleBuffers.values()].filter((b) => b.length >= 50).length;
		log(`[Organism] ✓ Bootstrap tamam: ${loaded}/${COINS.length} coin hazır. Gözlemciler ve testler ANINDA aktif.`);
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

		// Add to buffer — bootstrap'la çakışan aynı mum güncellenir, eklenmez
		if (!this.candleBuffers.has(coin)) this.candleBuffers.set(coin, []);
		const buffer = this.candleBuffers.get(coin)!;
		const last = buffer[buffer.length - 1];
		if (last && last.timestamp === tick.timestamp) {
			buffer[buffer.length - 1] = tick;
		} else {
			buffer.push(tick);
		}

		// Keep last 200 candles per coin
		if (buffer.length > 200) buffer.splice(0, buffer.length - 200);

		this.tickCount++;

		// Run analysis on every candle close
		this.runObservationCycle(tick.timestamp);
	}

	// ─── Core Cycle ───────────────────────────────────────────────────────

	private runObservationCycle(candleTs: number): void {
		// Step 1: Observers produce observations — period başına BİR kez.
		// (handleKline 10 coinin her kapanışında tetiklenir; gözlemciler durum
		// bazlı olduğundan her çağrıda aynı gözlemi yeniden üretip akışı
		// spamlıyordu.)
		let observations: Observation[] = [];
		const period = Math.floor(candleTs / 900_000); // 15dk period indeksi
		if (period !== this.lastObservationPeriod) {
			this.lastObservationPeriod = period;

			for (const observer of this.observers) {
				try {
					const obs = observer.observe(this.candleBuffers);
					observations.push(...obs);
				} catch (err) {
					logError(`[Organism] Observer ${observer.name} error: ${err}`);
				}
			}

			// Tekrar filtresi: aynı tip+coin seti gözlem 8 period (2 saat) içinde
			// yeniden yayınlanmaz — koşul sürüyor diye akış dolmasın.
			observations = observations.filter((obs) => {
				const key = `${obs.type}:${[...(obs.coins || [])].sort().slice(0, 3).join(',')}`;
				const lastPeriod = this.obsCooldown.get(key) ?? -Infinity;
				if (period - lastPeriod < 8) return false;
				this.obsCooldown.set(key, period);
				return true;
			});
		}

		// Log observations
		for (const obs of observations) {
			this.observationCount++;
			this.graph.addObservation(obs);
			log(`[${obs.type.toUpperCase()}] ${obs.description}`);
		}

		// Rejim dedektörünü canlı tut (bayatsa arka planda tazelenir)
		this.regime.getRegime();

		// Gözlem Karnesi: yeni gözlemleri kuyruğa al, olgunlaşan ufukları ölç
		try {
			if (observations.length > 0) this.scoreboard.record(observations, this.candleBuffers);
			this.scoreboard.update(this.candleBuffers);
		} catch (err) {
			logError(`[Organism] Scoreboard error: ${err}`);
		}

		// Deneyleri yürüt (kağıt üstünde)
		try {
			this.experimentRunner.processTick(this.candleBuffers, observations);
		} catch (err) {
			logError(`[Organism] Experiment runner error: ${err}`);
		}

		// Kanıttan yeni deney doğur, terfi/öldürme kararlarını ver
		if (this.tickCount % 20 === 0) {
			try {
				this.evolver.evolve(this.scoreboard);
			} catch (err) {
				logError(`[Organism] Evolver error: ${err}`);
			}
		}

		// Durum yazdır
		if (this.tickCount % 50 === 0) {
			this.printStatus();
		}
	}

	// ─── Display ──────────────────────────────────────────────────────────

	private printStatus(): void {
		const graphStats = this.graph.stats();
		const experiments = this.experimentRunner.getExperiments();
		const runningExps = experiments.filter(e => e.status === 'running');
		const completedExps = experiments.filter(e => e.status === 'completed');
		const totalTrades = experiments.reduce((s, e) => s + e.stats.totalTrades, 0);

		log('');
		log('┌─ Organism Status ─────────────────────────────────────────┐');
		log(`│ Ticks: ${this.tickCount}  Observations: ${this.observationCount}  Knowledge: ${graphStats.nodes}`);
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
