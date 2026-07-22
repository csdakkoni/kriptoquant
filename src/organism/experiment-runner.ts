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
import type { MarketRegime } from './regime.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE_DIR = join(process.cwd(), 'organism-data');
const EXPERIMENTS_FILE = join(STATE_DIR, 'experiments.json');

// Gerçekçi işlem maliyeti: %0.10 komisyon + %0.05 slipaj her yönde ≈ %0.3 tur.
// KRİTİK: Bu olmadan organizma "ücret illüzyonu" bilgiler üretir — 100+
// konfigürasyonluk lab arşivi (legacy-two-wing branch) bunu kanıtladı:
// maliyetsiz simülasyonda pozitif görünen her hızlı strateji gerçekte eksiydi.
const ROUND_TRIP_COST_PCT = 0.3;

/** Saf random kontrol grupları — ölümsüzdür, süre dolunca yeniden doğarlar. */
export function isControlExperiment(name: string): boolean {
	return (name || '').startsWith('Random ');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExperimentStatus = 'running' | 'completed' | 'failed';

export type EntryRule =
	| { type: 'random'; probability: number }        // Enter randomly with given probability per candle
	| { type: 'every_n'; n: number }                  // Enter every N candles
	| { type: 'on_observation'; observationType: string } // Enter when observer fires
	| { type: 'price_cross_sma'; period: number }     // Enter on SMA cross (upward)
	| { type: 'price_cross_sma_down'; period: number } // Enter on SMA cross (downward — short girişleri için)
	| { type: 'dip_from_high'; lookback: number; dipPercent: number }   // Tepeden %X düşüş ANINDA gir (kesişim — swing dip)
	| { type: 'rally_from_low'; lookback: number; rallyPercent: number } // Dipten %X yükseliş ANINDA gir (kesişim — rally fade short)
	| { type: 'anti_breakout'; thresholdPercent: number } // Büyük yeşil mumlarda (hacimli kırılım) TERSİNE gir (Tuzak avcısı)
	| { type: 'random_in_hours'; probability: number; startHourUtc: number; endHourUtc: number } // Sadece belirli UTC saat aralığında rastgele gir
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
	lastTickTs?: number; // Son işlenen mumun zaman damgası — çift sayımı önler
}

export interface Experiment {
	id: string;
	name: string;
	hypothesis: string;
	sourceAssumption?: string;  // Which assumption spawned this
	entryRule: EntryRule;
	exitRule: ExitRule;
	// Pozisyon yönü (varsayılan: long).
	// 'regime' = yönü piyasa rejimi seçer: BULL→long, BEAR→short, CHOP→nakit (giriş yok).
	side?: 'long' | 'short' | 'regime';
	promoted?: boolean;         // Evolver terfi kararı — kalıcı (restart'ta unutulmaz)
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
			name: 'Hit & Run Scalp (1% / 1%)',
			hypothesis: 'Testere piyasasında çok dar hedefle vur-kaç yapmak trend takibinden daha kârlıdır',
			sourceAssumption: 'chop-market-rules',
			entryRule: { type: 'random', probability: 0.1 },
			exitRule: { type: 'stop_and_target', stopPercent: 1.0, targetPercent: 1.0 },
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
		...createShortExperiments(),
	];
}

/**
 * Short deneyler — iki kanat dersi (legacy-two-wing): 365 günlük ayı verisinde
 * pozitif çıkan TEK strateji ailesi short trend takibiydi (Donchian short
 * PF 1.288). Deney seti long-only kalırsa organizma ayıda kör kalır.
 */
export function createShortExperiments(): Experiment[] {
	const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
	const base = {
		status: 'running' as ExperimentStatus,
		startedAt: Date.now(),
		maxDurationHours: 168,
		positions: [],
		closedPositions: [],
		stats: emptyStats(),
	};

	return [
		{
			...base,
			id: randomUUID(),
			name: 'Anti-Breakout SHORT (Tuzak Avcısı)',
			hypothesis: 'Büyük hacimli yeşil kırılımlar FOMO tuzağıdır, tersi yönünde kısa scalp kazandırır',
			entryRule: { type: 'anti_breakout', thresholdPercent: 1.5 },
			exitRule: { type: 'stop_and_target', stopPercent: 1.0, targetPercent: 1.5 },
			side: 'short' as const,
			coins,
		},
		{
			...base,
			id: randomUUID(),
			name: 'SMA20 Aşağı Kırılım SHORT + Trailing',
			hypothesis: 'Düşüş kırılımını short\'lamak ayı piyasasında pozitif olmalı (Donchian short bulgusunun canlı testi)',
			entryRule: { type: 'price_cross_sma_down', period: 20 },
			exitRule: { type: 'trailing_stop', percent: 1.5 },
			side: 'short' as const,
			coins,
		},
		{
			...base,
			id: randomUUID(),
			name: 'Random SHORT + Stop/Target (1%/2%)',
			hypothesis: 'Kontrol grubu: rastgele short, ayı driftinde bile maliyet sonrası başabaş kalmalı',
			entryRule: { type: 'random', probability: 0.05 },
			exitRule: { type: 'stop_and_target', stopPercent: 1, targetPercent: 2 },
			side: 'short' as const,
			coins,
		},
		// ── Swing ölçeği: büyük hedefler, maliyetin önemsizleştiği bölge ──
		// Mikro deneylerde (%1-2 hedef) %0.3 maliyet kârın üçte birini yer;
		// %5-6 hedefte %5'ini. Lab bulgusu: rally fade %5 short PF 1.109 (POZİTİF).
		{
			...base,
			id: randomUUID(),
			name: 'Swing Dip %5 → Hedef +%6 (Erdem ölçeği)',
			hypothesis: '48s tepesinden %5 düşeni almak, büyük hedefle maliyeti önemsizleştirir',
			entryRule: { type: 'dip_from_high', lookback: 192, dipPercent: 5 },
			exitRule: { type: 'stop_and_target', stopPercent: 6, targetPercent: 6 },
			coins,
			maxDurationHours: 336, // swing işlemler günlerce sürer — 2 hafta pencere
		},
		{
			...base,
			id: randomUUID(),
			name: 'Rally Fade %5 → SHORT Hedef -%5',
			hypothesis: 'Ayıda dipten %5 sıçrayanı short\'lamak pozitif (lab: PF 1.109)',
			entryRule: { type: 'rally_from_low', lookback: 192, rallyPercent: 5 },
			exitRule: { type: 'stop_and_target', stopPercent: 5, targetPercent: 5 },
			side: 'short' as const,
			coins,
			maxDurationHours: 336,
		},
		// ── Rejim Anahtarı: canlı verinin ana bulgusunun sentezi ──
		// Random LONG -16.9% / Random SHORT +7.6% (aynı kural!) → yön her şey.
		// Bu deney yönü rejime devreder: BULL→long, BEAR→short, CHOP→nakit.
		// Üç kardeş (saf long / saf short / rejim anahtarlı) yan yana yarışır;
		// anahtar değer katıyorsa uzun vadede iki saf yönü de geçmeli.
		// ── 20 Tem raporunun iki bulgusundan doğan deneyler ──
		// (1) Çıkış kırılımı: İz Süren %1.5 → 49 işlem, %29 kazanma, -22 puan.
		// En çok kullanılan çıkış en çok zarar ettiren çıkıştı. Hipotez: stop
		// çok dar, normal gürültüde tetikleniyor. Aynı girişle geniş trailing
		// test edilir — fark çıkarsa "çıkış genişliği" gerçek bir kaldıraçtır.
		{
			...base,
			id: randomUUID(),
			name: 'Rejim + Geniş Trailing (%3)',
			hypothesis: 'İz süren stop %1.5 çok dardı (-22 puan). %3 ile gürültüye dayanıp trendi tutabilir mi?',
			entryRule: { type: 'random', probability: 0.05 },
			exitRule: { type: 'trailing_stop', percent: 3 },
			side: 'regime' as const,
			coins,
			maxDurationHours: 336,
		},
		// (2) Saat kırılımı: 06:00–12:00 UTC tek pozitif dilim (+8.22, %60
		// kazanma, n=20) — diğer üç dilim toplamda -46 puan. Küçük örneklem,
		// ama sıfır maliyetle test edilebilir: aynı random kural, sadece o
		// pencerede. Rejim yönüyle birleştirilir.
		{
			...base,
			id: randomUUID(),
			name: 'Altın Saat 06-12 UTC (Rejim Yönlü)',
			hypothesis: '06-12 UTC dilimi kırılım analizinde tek pozitif dilimdi (+8.22%). Gerçek bir seans etkisi mi, gürültü mü?',
			entryRule: { type: 'random_in_hours', probability: 0.12, startHourUtc: 6, endHourUtc: 12 },
			exitRule: { type: 'stop_and_target', stopPercent: 1, targetPercent: 2 },
			side: 'regime' as const,
			coins,
			maxDurationHours: 336,
		},
		{
			...base,
			id: randomUUID(),
			name: 'Rejim Anahtarlı Random (1%/2%)',
			hypothesis: 'Yön her şeyse ve yönü rejim seçerse (BULL→long, BEAR→short, CHOP→nakit), saf yönlü random kardeşleri uzun vadede geçilmeli',
			entryRule: { type: 'random', probability: 0.05 },
			exitRule: { type: 'stop_and_target', stopPercent: 1, targetPercent: 2 },
			side: 'regime' as const,
			coins,
			maxDurationHours: 336, // rejim geçişlerini görebilmesi için 2 hafta
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
	// Deney+coin başına son giriş değerlendirmesi yapılan mumun zaman damgası.
	// KRİTİK: processTick, HERHANGİ bir coinin mum kapanışında çağrılır (10 coin
	// = her 15dk'da ~10 çağrı). Bu kapı olmadan giriş zarı mum başına ~10 kez
	// atılır (%5 ihtimal fiilen ~%40 olur) ve sayaçlar 10x şişer.
	private lastEntryCandle = new Map<string, number>();

	// Rejim sağlayıcı — 'regime' yönlü deneyler pozisyon açarken yönü buradan alır
	private regimeProvider: () => MarketRegime = () => 'UNKNOWN';

	constructor(graph: KnowledgeGraph) {
		this.graph = graph;
		this.load();
	}

	setRegimeProvider(provider: () => MarketRegime): void {
		this.regimeProvider = provider;
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
				this.closeExperiment(exp, ticks);
				continue;
			}

			for (const coin of exp.coins) {
				const candles = ticks.get(coin);
				if (!candles || candles.length < 2) continue;

				const latest = candles[candles.length - 1];

				// Update open positions (çıkış kontrolü idempotent — her çağrıda güvenli)
				this.updatePositions(exp, coin, latest);

				// Giriş değerlendirmesi: coin başına YENİ mumda yalnızca BİR kez
				const entryKey = `${exp.id}:${coin}`;
				if (this.lastEntryCandle.get(entryKey) === latest.timestamp) continue;
				this.lastEntryCandle.set(entryKey, latest.timestamp);

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

			case 'every_n': {
				// Global tickCount 10 coinin kapanışlarıyla şiştiği için kullanılmaz;
				// mumun kendi 15dk periyot indeksi deterministik ve şişmez.
				const latestTs = candles[candles.length - 1].timestamp;
				return Math.floor(latestTs / 900_000) % rule.n === 0;
			}

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

			case 'price_cross_sma_down': {
				if (candles.length < rule.period + 1) return false;
				const sma = candles.slice(-rule.period).reduce((s, c) => s + c.close, 0) / rule.period;
				const prev = candles[candles.length - 2].close;
				const curr = candles[candles.length - 1].close;
				return prev > sma && curr <= sma;
			}

			case 'dip_from_high': {
				// Kesişim semantiği: önceki mum çizginin ÜSTÜNDE, şimdiki ALTINDA olmalı.
				// Böylece uzun düşüşte her mumda yeniden giriş yapılmaz (doğal re-arm).
				if (candles.length < rule.lookback + 2) return false;
				const window = candles.slice(-(rule.lookback + 1), -1);
				const rollHigh = Math.max(...window.map(c => c.high));
				const dipLine = rollHigh * (1 - rule.dipPercent / 100);
				const prev = candles[candles.length - 2].close;
				const curr = candles[candles.length - 1].close;
				return prev > dipLine && curr <= dipLine;
			}

			case 'random_in_hours': {
				const h = new Date(candles[candles.length - 1].timestamp).getUTCHours();
				const inWindow = rule.startHourUtc <= rule.endHourUtc
					? h >= rule.startHourUtc && h < rule.endHourUtc
					: h >= rule.startHourUtc || h < rule.endHourUtc; // gece yarısını saran pencere
				return inWindow && Math.random() < rule.probability;
			}

			case 'rally_from_low': {
				if (candles.length < rule.lookback + 2) return false;
				const window = candles.slice(-(rule.lookback + 1), -1);
				const rollLow = Math.min(...window.map(c => c.low));
				const rallyLine = rollLow * (1 + rule.rallyPercent / 100);
				const prev = candles[candles.length - 2].close;
				const curr = candles[candles.length - 1].close;
				return prev < rallyLine && curr >= rallyLine;
			}

			case 'anti_breakout': {
				if (candles.length < 20) return false;
				const c = candles[candles.length - 1];
				// Hacimli büyük yeşil mum mu?
				const avgVol = candles.slice(-20, -1).reduce((s, x) => s + x.volume, 0) / 19;
				const isHighVol = c.volume > avgVol * 2.0;
				const retPct = ((c.close - c.open) / c.open) * 100;
				// Eğer eşik değerden büyük bir artış ve hacim varsa tetikle
				return retPct >= rule.thresholdPercent && isHighVol;
			}

			case 'always_long':
				return true;

			default:
				return false;
		}
	}

	// ─── Position Management ──────────────────────────────────────────

	private openPosition(exp: Experiment, coin: string, tick: MarketTick): void {
		let side: 'long' | 'short';
		if (exp.side === 'regime') {
			// Yönü rejim seçer; CHOP/UNKNOWN'da nakit — pozisyon açılmaz.
			const regime = this.regimeProvider();
			if (regime === 'BULL') side = 'long';
			else if (regime === 'BEAR') side = 'short';
			else return;
		} else {
			side = exp.side ?? 'long';
		}
		const pos: PaperPosition = {
			id: randomUUID(),
			experimentId: exp.id,
			coin,
			side,
			entryPrice: tick.close,
			entryTime: tick.timestamp,
			candlesSinceEntry: 0,
			highSinceEntry: tick.close,
			lowSinceEntry: tick.close,
			lastTickTs: tick.timestamp, // giriş mumu sayaca dahil edilmez
		};
		exp.positions.push(pos);

		log(`[EXPERIMENT] ${side === 'short' ? '📉' : '📈'} ${exp.name} | ${coin} ${side.toUpperCase()} @ ${tick.close.toFixed(2)}`);
	}

	private updatePositions(exp: Experiment, coin: string, tick: MarketTick): void {
		const openPos = exp.positions.filter(p => p.coin === coin && !p.exitPrice);

		for (const pos of openPos) {
			// Mum sayacı ve high/low takibi yalnızca YENİ mumda ilerler —
			// aynı mumun tekrar işlenmesi (diğer coinlerin kapanış tetiklemeleri)
			// sayaçları şişirmez.
			if (pos.lastTickTs !== tick.timestamp) {
				(pos as any).lastTickTs = tick.timestamp;
				pos.candlesSinceEntry++;
				if (tick.high > pos.highSinceEntry) (pos as any).highSinceEntry = tick.high;
				if (tick.low < pos.lowSinceEntry) (pos as any).lowSinceEntry = tick.low;
			}

			const shouldExit = this.checkExit(exp.exitRule, pos, tick);
			if (shouldExit) {
				this.closePosition(exp, pos, tick, shouldExit);
			}
		}
	}

	private checkExit(rule: ExitRule, pos: PaperPosition, tick: MarketTick): string | null {
		// Yön farkındalığı: short pozisyonda kâr, fiyat DÜŞÜNCE oluşur.
		const sign = pos.side === 'short' ? -1 : 1;
		const currentPnl = sign * ((tick.close - pos.entryPrice) / pos.entryPrice) * 100;

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
				// Long: zirveden geri çekilme | Short: dipten geri yükselme
				const drawback = pos.side === 'short'
					? ((tick.close - pos.lowSinceEntry) / pos.lowSinceEntry) * 100
					: ((pos.highSinceEntry - tick.close) / pos.highSinceEntry) * 100;
				if (drawback >= rule.percent) return 'trailing_stop';
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
		const sign = pos.side === 'short' ? -1 : 1;
		(pos as any).exitPrice = tick.close;
		(pos as any).exitTime = tick.timestamp;
		(pos as any).exitReason = reason;
		// Net PnL = yönlü brüt getiri - gidiş/dönüş işlem maliyeti
		(pos as any).pnlPercent = sign * ((tick.close - pos.entryPrice) / pos.entryPrice) * 100 - ROUND_TRIP_COST_PCT;

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

	/**
	 * Kontrol grupları BİLİMSEL ZORUNLULUKTUR — süresi dolunca ölmez, yeni
	 * nesil olarak yeniden doğar. Aksi halde (18-20 Tem raporunda görüldüğü
	 * gibi) tüm random kontroller ölür ve yeni deneyleri kıyaslayacak referans
	 * kalmaz: "bu deney rastgeleyi yeniyor mu?" sorusu cevapsız kalır.
	 */
	private respawnControl(exp: Experiment): void {
		const fresh: Experiment = {
			...exp,
			id: randomUUID(),
			status: 'running',
			startedAt: Date.now(),
			endedAt: undefined,
			promoted: false,
			positions: [],
			closedPositions: [],
			stats: emptyStats(),
		};
		this.experiments.push(fresh);
		log(`[EXPERIMENT] ♻️  Kontrol grubu yeniden doğdu: "${exp.name}" (yeni nesil)`);
	}

	private closeExperiment(exp: Experiment, ticks?: Map<string, MarketTick[]>): void {
		// Süre dolduğunda açık pozisyonlar son bilinen fiyattan kapatılır —
		// aksi halde istatistikler eksik kalır ve pozisyonlar zombiye döner.
		if (ticks) {
			for (const pos of [...exp.positions]) {
				if (pos.exitPrice) continue;
				const candles = ticks.get(pos.coin);
				if (candles && candles.length > 0) {
					this.closePosition(exp, pos, candles[candles.length - 1], 'experiment_end');
				}
			}
		}
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

		// Kontrol grubuysa yerine yenisi doğar (referans hiç kaybolmaz)
		if (isControlExperiment(exp.name)) this.respawnControl(exp);

		this.save();
	}

	addExperiment(exp: Experiment): void {
		// İsim bazlı tekilleştirme: Evolver'ın restart sonrası aynı sentez/çaprazlama
		// deneyini yeniden doğurmasını engeller.
		const exists = this.experiments.some((e) => e.name === exp.name);
		if (exists) {
			log(`[EXPERIMENT] ⏭️  Atlandı (zaten mevcut): "${exp.name}"`);
			return;
		}
		this.experiments.push(exp);
		this.save();
	}

	/** Evolver kararlarını kalıcılaştırmak için dışarıdan çağrılabilir. */
	persist(): void {
		this.save();
	}

	// ─── Persistence ──────────────────────────────────────────────────

	private load(): void {
		if (existsSync(EXPERIMENTS_FILE)) {
			try {
				this.experiments = JSON.parse(readFileSync(EXPERIMENTS_FILE, 'utf-8'));
				this.migrate();
				return;
			} catch {}
		}
		// Create defaults
		this.experiments = createDefaultExperiments();
		this.save();
	}

	/** Eski state dosyalarına yeni zorunlu deneyleri (short kanat) ekler ve
	 *  restart kaynaklı mükerrer deneyleri temizler (fazla işlemlisi kalır). */
	private migrate(): void {
		let changed = false;

		// Mükerrer isim temizliği
		const byName = new Map<string, Experiment>();
		for (const e of this.experiments) {
			const prev = byName.get(e.name);
			if (!prev) {
				byName.set(e.name, e);
			} else {
				const keep = e.stats.totalTrades >= prev.stats.totalTrades ? e : prev;
				byName.set(e.name, keep);
				log(`[EXPERIMENT] 🧹 Mükerrer deney temizlendi: "${e.name}"`);
				changed = true;
			}
		}
		if (changed) this.experiments = [...byName.values()];

		for (const shortExp of createShortExperiments()) {
			const exists = this.experiments.some((e) => e.name === shortExp.name);
			if (!exists) {
				this.experiments.push(shortExp);
				log(`[EXPERIMENT] 🧬 Migration: yeni deney eklendi — "${shortExp.name}"`);
				changed = true;
			}
		}
		if (changed) this.save();
	}

	private save(): void {
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(EXPERIMENTS_FILE, JSON.stringify(this.experiments, null, 2));
	}
}
