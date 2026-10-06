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
import { DivergenceObserver, SilenceObserver, HerdObserver, SurpriseObserver, LiquidityWickObserver, BollingerSqueezeObserver, FundingExtremeObserver } from './observers.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ObservationScoreboard } from './observation-scoreboard.js';
import { ExperimentRunner } from './experiment-runner.js';
import { Evolver } from './evolver.js';
import * as crypto from 'node:crypto';
import { RegimeDetector } from './regime.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fundingTracker } from './funding.js';
import { dailyCandles } from './daily-candles.js';
import { config } from '../core/config.js';

// Fiyat verisi FUTURES piyasasından alınır: işlemler de orada yapılacağı için
// paper sonuçları ile canlı sonuçlar aynı fiyatlara dayanmalı (spot ≠ futures).
const FUTURES_REST = process.env.FUTURES_REST_URL || 'https://fapi.binance.com';
const FUTURES_WS = process.env.FUTURES_WS_URL || 'wss://fstream.binance.com/stream';

// Testlerin gerçek durumu ezmemesi için dizin ORGANISM_DATA_DIR ile değiştirilebilir
const STATE_DIR = process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');

const COINS = [
	// Tier 1 — Majörler (mevcut)
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
	// Tier 2 — Büyük Altcoinler (mevcut)
	'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT',
	// Tier 3 — Yüksek Hacimli Altcoinler (yeni)
	'POLUSDT', 'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'AAVEUSDT',
	'UNIUSDT', 'ARBUSDT', 'OPUSDT', 'FILUSDT', 'ATOMUSDT',
	'INJUSDT', 'RENDERUSDT', 'LTCUSDT', 'TRXUSDT', 'ICPUSDT',
];
const INTERVAL = '15m';

export class AssumptionKiller {
	private ws: WebSocket | null = null;
	private pollTimer: NodeJS.Timeout | null = null;
	private lastWsKlineAt = 0;
	private restFallbackLogged = false;
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
	// KRİTİK: Gözlemleri period boyunca hafızada tut. Eskiden her handleKline
	// çağrısında yerel `observations` değişkeni kullanılıyordu ve ilk gelen coin
	// (genellikle BNB) gözlemleri alıyor, sonrakiler boş listeyle karşılaşıyordu.
	// Bu race condition tüm on_observation deneylerinin tek bir coinde
	// yoğunlaşmasına neden oluyordu.
	private currentPeriodObservations: Observation[] = [];
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
			new FundingExtremeObserver((coin) => fundingTracker.latest(coin)),
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

		// Funding geçmişini yükle (paper maliyetleri gerçek oranlarla hesaplanır)
		await fundingTracker.refresh(COINS);
		// Günlük mumlar (günlük trend deneyi için)
		await dailyCandles.refresh(COINS, true);

		// Borsa ile pozisyon mutabakatı (Reconciliation)
		await this.experimentRunner.reconcile();

		// Rejim dedektörünü uyandır (ilk fetch'i tetikler; 15dk'da bir tazelenir)
		this.regime.getRegime();

		// Connect to Binance WebSocket for live data
		this.connectWebSocket();

		// Güvenlik ağı: WebSocket bağlı görünüp veri göndermezse (veya koparken
		// mum kaçırılırsa) kapanan mumlar REST'ten çekilir. Dakikada bir kontrol.
		this.pollTimer = setInterval(() => {
			this.backfillMissedCandles().catch((err) => logError(`[Organism] REST yedek hatası: ${err}`));
		}, 60_000);

		const expCount = this.experimentRunner.getExperiments().filter(e => e.status === 'running').length;
		log(`[Organism] Watching ${COINS.length} coins on ${INTERVAL}. ${this.observers.length} observers active.`);
		log(`[Organism] ${expCount} deney çalışıyor.`);
	}

	stop(): void {
		this.running = false;
		if (this.pollTimer) clearInterval(this.pollTimer);
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
					`${FUTURES_REST}/fapi/v1/klines?symbol=${coin}&interval=${INTERVAL}&limit=501`,
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
		const url = `${FUTURES_WS}?streams=${streams}`;

		this.ws = new WebSocket(url);

		this.ws.on('open', () => {
			log(`[Organism] Connected to Binance WebSocket (${COINS.length} streams)`);
		});

		this.ws.on('message', (data: Buffer) => {
			try {
				const parsed = JSON.parse(data.toString());
				if (parsed.data?.k) {
					this.lastWsKlineAt = Date.now();
					this.handleKline(parsed.data);
				}
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

	/**
	 * Son kapanan 15dk mumu bir coinde 30 sn içinde gelmediyse REST'ten çeker.
	 * WebSocket sağlıklıysa hiçbir şey yapmaz.
	 */
	private async backfillMissedCandles(): Promise<void> {
		const PERIOD = 900_000;
		const now = Date.now();
		const lastClosedStart = Math.floor(now / PERIOD) * PERIOD - PERIOD;
		if (now - (lastClosedStart + PERIOD) < 30_000) return; // WS'e süre tanı

		const missing = COINS.filter((c) => {
			const buf = this.candleBuffers.get(c);
			return !buf || buf.length === 0 || buf[buf.length - 1].timestamp < lastClosedStart;
		});
		if (missing.length === 0) return;

		if (!this.restFallbackLogged) {
			const wsAge = this.lastWsKlineAt ? `${Math.round((now - this.lastWsKlineAt) / 1000)} sn önce` : 'hiç';
			logError(`[Organism] ⚠️ ${missing.length} coinde son mum WebSocket'ten gelmedi (son WS verisi: ${wsAge}). REST yedeği devrede.`);
			this.restFallbackLogged = true;
		}

		for (const coin of missing) {
			try {
				const res = await fetch(`${FUTURES_REST}/fapi/v1/klines?symbol=${coin}&interval=${INTERVAL}&limit=6`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as any[];
				// Son eleman hâlâ açık mumdur — yalnızca kapananlar, eskiden yeniye
				for (const d of data.slice(0, -1)) {
					this.ingestClosedCandle({
						coin,
						timestamp: Number(d[0]),
						open: parseFloat(d[1]),
						high: parseFloat(d[2]),
						low: parseFloat(d[3]),
						close: parseFloat(d[4]),
						volume: parseFloat(d[5]),
						interval: INTERVAL,
					});
				}
			} catch (err) {
				logError(`[Organism] ${coin} REST mum yedeği alınamadı: ${err}`);
			}
		}
	}

	private handleKline(data: any): void {
		const k = data.k;
		if (!k.x) return; // Only process closed candles

		this.ingestClosedCandle({
			coin: k.s as string,
			timestamp: k.t,
			open: parseFloat(k.o),
			high: parseFloat(k.h),
			low: parseFloat(k.l),
			close: parseFloat(k.c),
			volume: parseFloat(k.v),
			interval: INTERVAL,
		});
	}

	/**
	 * Kapanmış mumu tampona ekler ve analiz döngüsünü çalıştırır.
	 * Aynı mum iki kaynaktan (WebSocket + REST yedeği) gelebilir: zaten
	 * işlenmiş mum TEKRAR işlenmez.
	 */
	private ingestClosedCandle(tick: MarketTick): void {
		const coin = tick.coin;
		if (!this.candleBuffers.has(coin)) this.candleBuffers.set(coin, []);
		const buffer = this.candleBuffers.get(coin)!;
		const last = buffer[buffer.length - 1];
		if (last && last.timestamp >= tick.timestamp) return;
		buffer.push(tick);

		// Keep last 500 candles per coin
		if (buffer.length > 500) buffer.splice(0, buffer.length - 500);

		this.tickCount++;

		// Run analysis on every candle close
		this.runObservationCycle(tick.timestamp);
	}

	// ─── Core Cycle ───────────────────────────────────────────────────────

	private runObservationCycle(candleTs: number): void {
		// Step 1: Observers produce observations — period başına BİR kez.
		// Gözlemler this.currentPeriodObservations'da saklanır ve o periyodun
		// TÜM coin kapanışlarında experiment runner'a iletilir. Böylece
		// WebSocket'ten ilk gelen coin (ör. BNB) gözlemleri tekelleştirmez.
		const period = Math.floor(candleTs / 900_000); // 15dk period indeksi
		if (period !== this.lastObservationPeriod) {
			this.lastObservationPeriod = period;
			this.currentPeriodObservations = []; // Yeni periyotta sıfırla

			for (const observer of this.observers) {
				try {
					const obs = observer.observe(this.candleBuffers);
					this.currentPeriodObservations.push(...obs);
				} catch (err) {
					logError(`[Organism] Observer ${observer.name} error: ${err}`);
				}
			}

			// Drift Baseline (Koşulsuz Getiri Ölçümü)
			this.currentPeriodObservations.push({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				type: 'baseline_drift',
				coins: Array.from(this.candleBuffers.keys()),
				description: 'Piyasanın koşulsuz yapısal sürüklenmesini (drift) ölçmek için referans gözlem',
				confidence: 1.0,
				relatedData: {}
			});

			// Tekrar filtresi: aynı tip+coin seti gözlem 8 period (2 saat) içinde
			// yeniden yayınlanmaz — koşul sürüyor diye akış dolmasın.
			this.currentPeriodObservations = this.currentPeriodObservations.filter((obs) => {
				const key = `${obs.type}:${[...(obs.coins || [])].sort().slice(0, 3).join(',')}`;
				const lastPeriod = this.obsCooldown.get(key) ?? -Infinity;
				if (period - lastPeriod < 8) return false;
				this.obsCooldown.set(key, period);
				return true;
			});

			// Log observations — sadece yeni periyodun ilk çağrısında
			for (const obs of this.currentPeriodObservations) {
				this.observationCount++;
				this.graph.addObservation(obs);
				log(`[${obs.type.toUpperCase()}] ${obs.description}`);
			}

			// Gözlem Karnesi: yeni gözlemleri kuyruğa al
			try {
				if (this.currentPeriodObservations.length > 0) {
					this.scoreboard.record(this.currentPeriodObservations, this.candleBuffers);
				}
			} catch (err) {
				logError(`[Organism] Scoreboard error: ${err}`);
			}

			// Periyodik borsa mutabakatı (15 dakikada bir, dry-run ise sessizce atlar)
			this.experimentRunner.reconcile().catch(err => logError(String(err)));

			// Yeni funding kayıtlarını çek (API anahtarı gerekmez)
			fundingTracker.refresh(COINS).catch(err => logError(String(err)));
			// Günlük mumlar (saatte bir tazelenir, arada çağrılar atlanır)
			dailyCandles.refresh(COINS).catch(err => logError(String(err)));
		}

		// Rejim dedektörünü canlı tut (bayatsa arka planda tazelenir)
		this.regime.getRegime();

		// Gözlem Karnesi: olgunlaşan ufukları ölç (her coin kapanışında)
		try {
			this.scoreboard.update(this.candleBuffers);
		} catch (err) {
			logError(`[Organism] Scoreboard update error: ${err}`);
		}

		// Deneyleri yürüt — KRİTİK: currentPeriodObservations kullanılır,
		// böylece BNB'den 50ms sonra gelen BTC/ETH/SOL de aynı herd
		// sinyalini görür ve işleme girebilir.
		try {
			this.experimentRunner.processTick(this.candleBuffers, this.currentPeriodObservations);
		} catch (err) {
			logError(`[Organism] Experiment runner error: ${err}`);
		}

		// Kanıttan yeni deney doğur, terfi/öldürme kararlarını ver (EVOLVER_ENABLED=true ise)
		if (config.evolverEnabled && this.tickCount % 20 === 0) {
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
