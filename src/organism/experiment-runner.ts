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
import { config } from '../core/config.js';
import type { MarketTick, Observation } from './types.js';
import type { MarketRegime } from './regime.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { LiveBroker } from './live-broker.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Testlerin gerçek durumu ezmemesi için dizin ORGANISM_DATA_DIR ile değiştirilebilir
const STATE_DIR = process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');
const EXPERIMENTS_FILE = join(STATE_DIR, 'experiments.json');

// Gerçekçi işlem maliyeti: %0.10 komisyon + %0.05 slipaj her yönde ≈ %0.3 tur.
// KRİTİK: Bu olmadan organizma "ücret illüzyonu" bilgiler üretir — 100+
// konfigürasyonluk lab arşivi (legacy-two-wing branch) bunu kanıtladı:
// maliyetsiz simülasyonda pozitif görünen her hızlı strateji gerçekte eksiydi.
const ROUND_TRIP_COST_PCT = 0.3;

/**
 * ATR (Average True Range) — her coinin kendi volatilite ölçü birimi.
 * BTC'nin %1'i ile DOGE'un %1'i aynı şey değildir; ATR bu farkı standardize eder.
 * Kullanım: giriş eşiği = dipMultiplier × ATR, stop = stopMultiplier × ATR.
 */
function calcATR(candles: MarketTick[], period: number = 14): number {
	if (candles.length < period + 1) return 0;
	const recent = candles.slice(-(period + 1));
	let sum = 0;
	for (let i = 1; i < recent.length; i++) {
		const tr = Math.max(
			recent[i].high - recent[i].low,
			Math.abs(recent[i].high - recent[i - 1].close),
			Math.abs(recent[i].low - recent[i - 1].close),
		);
		sum += tr;
	}
	return sum / period;
}

/** ATR'yi yüzde cinsinden döndür (fiyata göre normalize). */
function calcATRPercent(candles: MarketTick[], period: number = 14): number {
	const atr = calcATR(candles, period);
	if (atr === 0 || candles.length === 0) return 0;
	const price = candles[candles.length - 1].close;
	return (atr / price) * 100;
}

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
	| { type: 'dip_from_high_atr'; lookback: number; dipMultiplier: number } // Tepeden ATR×N düşüş — her coinin kendi volatilitesine göre
	| { type: 'rally_from_low'; lookback: number; rallyPercent: number } // Dipten %X yükseliş ANINDA gir (kesişim — rally fade short)
	| { type: 'anti_breakout'; thresholdPercent: number } // Büyük yeşil mumlarda (hacimli kırılım) TERSİNE gir (Tuzak avcısı)
	| { type: 'random_in_hours'; probability: number; startHourUtc: number; endHourUtc: number } // Sadece belirli UTC saat aralığında rastgele gir
	| { type: 'always_long' };                         // Always be in position

export type ExitRule =
	| { type: 'fixed_candles'; n: number }             // Exit after N candles
	| { type: 'stop_loss'; percent: number }           // Exit on % loss
	| { type: 'take_profit'; percent: number }         // Exit on % gain
	| { type: 'trailing_stop'; percent: number }       // Trailing stop
	| { type: 'stop_and_target'; stopPercent: number; targetPercent: number } // Both
	| { type: 'stop_and_target_atr'; stopMultiplier: number; targetMultiplier: number }; // ATR bazlı stop/target

export interface PaperPosition {
	id: string;
	experimentId: string;
	coin: string;
	side: 'long' | 'short';
	entryPrice: number;
	entryTime: number;
	entryATR?: number; // Pozisyon açılırken kaydedilen ATR (yüzde cinsinden) — ATR bazlı stop/target için
	clusterId?: string; // Aynı 15dk periyodunda açılan pozisyonlar aynı clusterId'yi paylaşır
	exitPrice?: number;
	exitTime?: number;
	exitReason?: string;
	pnlPercent?: number;
	candlesSinceEntry: number;
	highSinceEntry: number;
	lowSinceEntry: number;
	lastTickTs?: number; // Son işlenen mumun zaman damgası — çift sayımı önler
	liveOrderId?: string;
	stopOrderId?: string;
	takeProfitOrderId?: string;
	isLive?: boolean;
}

/** Pozisyon kuralına ve ATR'ye göre borsa tarafına iletilecek Stop-Loss ve Take-Profit tetik fiyatlarını hesaplar */
export function calculateBracketPrices(
	rule: ExitRule,
	entryPrice: number,
	side: 'long' | 'short',
	entryATR?: number,
): { stopPrice?: number; targetPrice?: number } {
	const isLong = side !== 'short';
	const off = (pct: number) => entryPrice * (1 + (isLong ? pct : -pct) / 100);

	switch (rule.type) {
		case 'stop_loss':
			return { stopPrice: off(-rule.percent) };
		case 'take_profit':
			return { targetPrice: off(rule.percent) };
		case 'stop_and_target':
			return {
				stopPrice: off(-rule.stopPercent),
				targetPrice: off(rule.targetPercent),
			};
		case 'stop_and_target_atr': {
			const atrPct = entryATR || 1;
			return {
				stopPrice: off(-(atrPct * rule.stopMultiplier)),
				targetPrice: off(atrPct * rule.targetMultiplier),
			};
		}
		case 'trailing_stop':
			// Trailing stop için başlangıç güvenlik stopu
			return { stopPrice: off(-rule.percent) };
		default:
			return {};
	}
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
	isLiveTradingEnabled?: boolean; // Canlı borsa işlemleri (gerçek veya dry-run) için yetki var mı?
	coins: string[];
	status: ExperimentStatus;
	startedAt: number;
	endedAt?: number;
	maxDurationHours: number;
	positions: PaperPosition[];
	closedPositions: PaperPosition[];
	stats: ExperimentStats;
	maxConcurrentPositions?: number; // Maksimum eşzamanlı açık pozisyon (varsayılan: 3)
	// "0 işlem" opak bir sayı olmasın: giriş koşulu neden tetiklenmedi, insan
	// diliyle ve mesafe ölçüsüyle yazılır. Pozisyon açıkken tanımsızdır.
	waiting?: string;
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
	const coins = [
		'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
		'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT',
		'MATICUSDT', 'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'AAVEUSDT',
		'UNIUSDT', 'ARBUSDT', 'OPUSDT', 'FILUSDT', 'ATOMUSDT',
		'INJUSDT', 'RENDERUSDT', 'LTCUSDT', 'TRXUSDT', 'ICPUSDT',
	];
	const base = () => ({
		status: 'running' as ExperimentStatus,
		startedAt: Date.now(),
		maxDurationHours: 720, // 30 days
		maxConcurrentPositions: 3, // Maksimum 3 eşzamanlı pozisyon (portföy korelasyon koruması)
		isLiveTradingEnabled: true,
		positions: [] as PaperPosition[],
		closedPositions: [] as PaperPosition[],
		stats: emptyStats(),
	});

	return [
		{
			...base(),
			id: randomUUID(),
			name: 'Altın Saat Swing (Rejim Yönlü, 3%/6%)',
			hypothesis: '06-12 UTC altın saatlerinde rejim yönünde geniş ufuklu (3% stop / 6% hedef) dalga yakalamak',
			sourceAssumption: 'exit-beats-entry',
			entryRule: { type: 'random_in_hours', startHourUtc: 6, endHourUtc: 12, probability: 0.1 },
			exitRule: { type: 'stop_and_target', stopPercent: 3.0, targetPercent: 6.0 },
			side: 'regime' as const,
			coins,
		},
		{
			...base(),
			id: randomUUID(),
			name: 'Swing Dip %5 → Hedef +%6 (Erdem ölçeği v1)',
			hypothesis: '48s tepesinden %5 düşeni almak, büyük hedefle maliyeti önemsizleştirir',
			sourceAssumption: 'entry-signal-matters',
			entryRule: { type: 'dip_from_high', lookback: 192, dipPercent: 5 },
			exitRule: { type: 'stop_and_target', stopPercent: 6, targetPercent: 6 },
			coins,
		},
		{
			...base(),
			id: randomUUID(),
			name: 'Swing Dip ATR → Hedef 3×ATR (Erdem ölçeği v2)',
			hypothesis: '48s tepesinden 2.5×ATR düşeni almak, her coinin kendi volatilitesine göre ölçülen gerçek dip',
			sourceAssumption: 'entry-signal-matters',
			entryRule: { type: 'dip_from_high_atr', lookback: 192, dipMultiplier: 2.5 },
			exitRule: { type: 'stop_and_target_atr', stopMultiplier: 3.0, targetMultiplier: 3.0 },
			coins,
		},
		{
			...base(),
			id: randomUUID(),
			name: 'Gözlem Tetikli Giriş (Herd 24h Takibi)',
			hypothesis: 'Sürü psikolojisi (herd) gözlemi 24 saat süren yapısal bir trend (drift) yaratır',
			sourceAssumption: 'trend-exists',
			entryRule: { type: 'on_observation', observationType: 'herd' },
			exitRule: { type: 'fixed_candles', n: 96 },
			coins,
		},
		{
			...base(),
			id: randomUUID(),
			name: 'Gözlem Tetikli Giriş (Silence Sıkışma Patlaması)',
			hypothesis: 'Aşırı volatilite sıkışması ve sessizlik (silence) sonrası başlayan kırılım yönünde 3%/6% dalga yakalamak',
			sourceAssumption: 'trend-exists',
			entryRule: { type: 'on_observation', observationType: 'silence' },
			exitRule: { type: 'stop_and_target', stopPercent: 3.0, targetPercent: 6.0 },
			side: 'regime' as const,
			coins,
		},
		{
			...base(),
			id: randomUUID(),
			name: 'Gözlem Tetikli Giriş (Divergence RSI Uyumsuzluğu)',
			hypothesis: 'Fiyat ile momentum uyumsuzluğu (divergence) satıcıların tükendiğini ve dipten dönüşün başladığını gösterir',
			sourceAssumption: 'entry-signal-matters',
			entryRule: { type: 'on_observation', observationType: 'divergence' },
			exitRule: { type: 'stop_and_target', stopPercent: 3.0, targetPercent: 6.0 },
			coins,
		}
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

	private liveBroker: LiveBroker;

	constructor(graph: KnowledgeGraph) {
		this.graph = graph;
		this.liveBroker = new LiveBroker();
		this.load();
		this.ensureCorePopulation(); // açılışta boş kadro kalmasın
	}

	setRegimeProvider(provider: () => MarketRegime): void {
		this.regimeProvider = provider;
	}

	getExperiments(): Experiment[] {
		return this.experiments;
	}

	getLiveBroker(): LiveBroker {
		return this.liveBroker;
	}

	async reconcile(): Promise<void> {
		const { reconcilePositions } = await import('./reconciliation.js');
		await reconcilePositions(this.experiments, this.liveBroker);
		this.save();
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

			// 1. Önce tüm coinlerin açık pozisyonlarını güncelle (çıkış kontrolü idempotent — her çağrıda güvenli)
			for (const coin of exp.coins) {
				const candles = ticks.get(coin);
				if (!candles || candles.length < 2) continue;
				const latest = candles[candles.length - 1];
				this.updatePositions(exp, coin, latest);
			}

			// 2. Açık pozisyon kotasını hesapla (Korelasyon Koruması)
			const openPositions = exp.positions.filter(p => !p.exitPrice);
			const maxConcurrent = exp.maxConcurrentPositions ?? 3;
			const availableSlots = maxConcurrent - openPositions.length;

			// 3. Eğer boş kontenjan varsa adayları topla ve puanla
			if (availableSlots > 0) {
				interface EntryCandidate {
					coin: string;
					latest: MarketTick;
					candles: MarketTick[];
					score: number;
				}
				const candidates: EntryCandidate[] = [];

				for (const coin of exp.coins) {
					// Coinde zaten açık pozisyon varsa ikinci pozisyonu açma
					if (openPositions.some(p => p.coin === coin)) continue;

					const candles = ticks.get(coin);
					if (!candles || candles.length < 2) continue;
					const latest = candles[candles.length - 1];

					// Giriş değerlendirmesi: coin başına YENİ mumda yalnızca BİR kez
					const entryKey = `${exp.id}:${coin}`;
					if (this.lastEntryCandle.get(entryKey) === latest.timestamp) continue;
					this.lastEntryCandle.set(entryKey, latest.timestamp);

					if (this.shouldEnter(exp, coin, candles, observations)) {
						const score = this.calculateEntryScore(exp, coin, candles, latest);
						candidates.push({ coin, latest, candles, score });
					}
				}

				// 4. En yüksek kaliteli adayları seç (en iyi 'availableSlots' tanesi)
				if (candidates.length > 0) {
					candidates.sort((a, b) => b.score - a.score);
					const toOpen = candidates.slice(0, availableSlots);
					for (const cand of toOpen) {
						this.openPosition(exp, cand.coin, cand.latest, cand.candles);
					}
				}
			}

			exp.waiting = this.describeWaiting(exp, ticks);
		}

		// Save periodically
		if (this.tickCount % 5 === 0) this.save();

		// Popülasyonu canlı tut: süresi dolan/öldürülen deneylerin yerine
		// yeni nesil doğsun (~her 100 tikte bir kontrol, ucuz işlem).
		if (this.tickCount % 100 === 0) this.ensureCorePopulation();
	}

	/**
	 * Birden fazla coinde aynı anda sinyal geldiğinde en iyi pozisyonları
	 * seçmek için öncelik skoru hesaplar (Eşzamanlı pozisyon sıralaması).
	 */
	private calculateEntryScore(exp: Experiment, coin: string, candles: MarketTick[], latest: MarketTick): number {
		const rule = exp.entryRule;
		switch (rule.type) {
			case 'dip_from_high': {
				// Zirveden en derin düşmüş olan (en ucuzlamış) ilk sırayı alır
				if (candles.length < rule.lookback + 2) return 0;
				const window = candles.slice(-(rule.lookback + 1), -1);
				const rollHigh = Math.max(...window.map(c => c.high));
				return ((rollHigh - latest.close) / rollHigh) * 100;
			}

			case 'dip_from_high_atr': {
				// ATR'sine oranla en derin tasfiye yemiş olan ilk sırayı alır
				if (candles.length < rule.lookback + 2) return 0;
				const atrPct = calcATRPercent(candles);
				const window = candles.slice(-(rule.lookback + 1), -1);
				const rollHigh = Math.max(...window.map(c => c.high));
				const dipPct = ((rollHigh - latest.close) / rollHigh) * 100;
				return atrPct > 0 ? dipPct / atrPct : dipPct;
			}

			case 'random_in_hours': {
				// Altın Saat: Son 20 mumluk ortalamaya göre en yüksek hacim patlaması (RVOL)
				const vol = latest.volume || 1;
				const recent = candles.slice(-20);
				const avgVol = recent.reduce((s, c) => s + (c.volume || 0), 0) / recent.length || 1;
				return vol / avgVol;
			}

			case 'on_observation': {
				// Hacim artış katsayısı
				const vol = latest.volume || 1;
				const recent = candles.slice(-20);
				const avgVol = recent.reduce((s, c) => s + (c.volume || 0), 0) / recent.length || 1;
				return vol / avgVol;
			}

			default: {
				const vol = latest.volume || 1;
				const recent = candles.slice(-20);
				const avgVol = recent.reduce((s, c) => s + (c.volume || 0), 0) / recent.length || 1;
				return vol / avgVol;
			}
		}
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

			case 'dip_from_high_atr': {
				// ATR bazlı dip tespiti: sabit %5 yerine her coinin kendi volatilitesine göre.
				// BTC için ~%3, DOGE için ~%7 gibi dinamik eşik.
				if (candles.length < rule.lookback + 2) return false;
				const atrPct = calcATRPercent(candles);
				if (atrPct === 0) return false;
				const dipPercent = atrPct * rule.dipMultiplier;
				const window = candles.slice(-(rule.lookback + 1), -1);
				const rollHigh = Math.max(...window.map(c => c.high));
				const dipLine = rollHigh * (1 - dipPercent / 100);
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

	/**
	 * Deney neden işlem yapmıyor? — "0 işlem" gören kullanıcı, deneyin BOZUK mu
	 * yoksa koşulunu mu beklediğini ayırt edemiyordu. Burası o farkı ölçülebilir
	 * bir cümleye çevirir: koşul + şu an eşiğe ne kadar uzak olduğu.
	 *
	 * Sadece açıklayıcıdır — hiçbir giriş/çıkış kararını etkilemez.
	 */
	private describeWaiting(exp: Experiment, ticks: Map<string, MarketTick[]>): string | undefined {
		const openPositions = exp.positions.filter(p => !p.exitPrice);
		const maxConcurrent = exp.maxConcurrentPositions ?? 3;
		if (openPositions.length >= maxConcurrent) {
			return `Eşzamanlı pozisyon kotası dolu (${openPositions.length}/${maxConcurrent} açık) — yeni giriş için pozisyon kapanışı bekleniyor`;
		}
		if (openPositions.length > 0) return undefined; // pozisyonda, beklemiyor

		// Rejim anahtarlı deneyler yatay piyasada TASARIM GEREĞİ nakittedir
		if (exp.side === 'regime') {
			const r = this.regimeProvider();
			if (r === 'CHOP') return 'Rejim YATAY — kural gereği nakitte (yön belirsizken pozisyon açmaz)';
			if (r === 'UNKNOWN') return 'Rejim henüz okunamadı — veri bekleniyor';
		}

		const rule = exp.entryRule;
		// Eşiğe en yakın coini bul: "hiç olmadı" ile "kıl payı kaçtı" farklı şeyler
		const closest = (fn: (c: MarketTick[]) => number | null): number | null => {
			let best: number | null = null;
			for (const coin of exp.coins) {
				const candles = ticks.get(coin);
				if (!candles || candles.length < 3) continue;
				const gap = fn(candles);
				if (gap === null) continue;
				if (best === null || gap < best) best = gap;
			}
			return best;
		};
		const pct = (n: number) => `%${n.toFixed(2)}`;

		switch (rule.type) {
			case 'dip_from_high': {
				const gap = closest((candles) => {
					if (candles.length < rule.lookback + 2) return null;
					const window = candles.slice(-(rule.lookback + 1), -1);
					const line = Math.max(...window.map(c => c.high)) * (1 - rule.dipPercent / 100);
					const curr = candles[candles.length - 1].close;
					return ((curr - line) / line) * 100; // >0 → henüz çizginin üstünde
				});
				const near = gap === null ? '' : ` — en yakın coin giriş çizgisinin ${pct(Math.abs(gap))} ${gap > 0 ? 'üstünde' : 'altında'}`;
				return `${rule.lookback} mumluk tepeden -${pct(rule.dipPercent)} düşüş bekliyor${near}`;
			}

			case 'dip_from_high_atr': {
				const gap = closest((candles) => {
					if (candles.length < rule.lookback + 2) return null;
					const atrPct = calcATRPercent(candles);
					if (atrPct === 0) return null;
					const dipPct = atrPct * rule.dipMultiplier;
					const window = candles.slice(-(rule.lookback + 1), -1);
					const line = Math.max(...window.map(c => c.high)) * (1 - dipPct / 100);
					const curr = candles[candles.length - 1].close;
					return ((curr - line) / line) * 100;
				});
				const near = gap === null ? '' : ` — en yakın coin giriş çizgisinin ${pct(Math.abs(gap))} ${gap > 0 ? 'üstünde' : 'altında'}`;
				return `${rule.lookback} mumluk tepeden -${rule.dipMultiplier}×ATR düşüş bekliyor${near}`;
			}

			case 'rally_from_low': {
				const gap = closest((candles) => {
					if (candles.length < rule.lookback + 2) return null;
					const window = candles.slice(-(rule.lookback + 1), -1);
					const line = Math.min(...window.map(c => c.low)) * (1 + rule.rallyPercent / 100);
					const curr = candles[candles.length - 1].close;
					return ((line - curr) / line) * 100; // >0 → henüz çizginin altında
				});
				const near = gap === null ? '' : ` — en yakın coin giriş çizgisinin ${pct(Math.abs(gap))} ${gap > 0 ? 'altında' : 'üstünde'}`;
				return `${rule.lookback} mumluk dipten +${pct(rule.rallyPercent)} yükseliş bekliyor${near}`;
			}

			case 'anti_breakout': {
				// Burada "en yakın" = son 20 mumun en büyük yeşil mumu
				let biggest: number | null = null;
				for (const coin of exp.coins) {
					const candles = ticks.get(coin);
					if (!candles || candles.length < 20) continue;
					for (const c of candles.slice(-20)) {
						const ret = ((c.close - c.open) / c.open) * 100;
						if (biggest === null || ret > biggest) biggest = ret;
					}
				}
				const near = biggest === null ? '' : ` — son 20 mumun en büyük yeşili ${pct(biggest)}`;
				return `Yüksek hacimli (2x) ve ${pct(rule.thresholdPercent)}'ten büyük yeşil mum bekliyor${near}`;
			}

			case 'price_cross_sma':
			case 'price_cross_sma_down': {
				const dir = rule.type === 'price_cross_sma' ? 'yukarı' : 'aşağı';
				const gap = closest((candles) => {
					if (candles.length < rule.period + 1) return null;
					const sma = candles.slice(-rule.period).reduce((s, c) => s + c.close, 0) / rule.period;
					return Math.abs(((candles[candles.length - 1].close - sma) / sma) * 100);
				});
				const near = gap === null ? '' : ` — en yakın coin ortalamaya ${pct(gap)} uzaklıkta`;
				return `Fiyatın ${rule.period} mumluk ortalamayı ${dir} kesmesini bekliyor${near}`;
			}

			case 'on_observation':
				return `"${rule.observationType}" gözlemi bekliyor — gözlemciler bu sinyali üretmedi`;

			case 'random_in_hours': {
				const anyCandles = [...ticks.values()].find(c => c.length > 0);
				if (!anyCandles) return undefined;
				const h = new Date(anyCandles[anyCandles.length - 1].timestamp).getUTCHours();
				const inWindow = rule.startHourUtc <= rule.endHourUtc
					? h >= rule.startHourUtc && h < rule.endHourUtc
					: h >= rule.startHourUtc || h < rule.endHourUtc;
				if (!inWindow) return `Saat penceresi dışında (yalnız ${rule.startHourUtc}:00–${rule.endHourUtc}:00 UTC arası işlem açar, şu an ${h}:00)`;
				return undefined; // pencere içinde — rastgele bekliyor, açıklamaya değmez
			}

			default:
				return undefined; // random / every_n / always_long: zaten düzenli işlem açar
		}
	}

	// ─── Position Management ──────────────────────────────────────────

	private openPosition(exp: Experiment, coin: string, tick: MarketTick, candles?: MarketTick[]): void {
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

		// ATR'yi pozisyon açılırken kaydet — çıkış kuralında kullanılacak
		const atrPct = candles ? calcATRPercent(candles) : 0;
		// Kümelenme takibi: aynı 15dk periyodunda aynı deneyde açılan pozisyonlar
		const period = Math.floor(tick.timestamp / 900_000);
		const clusterId = `${exp.id.slice(0, 8)}:${period}`;

		const pos: PaperPosition = {
			id: randomUUID(),
			experimentId: exp.id,
			coin,
			side,
			entryPrice: tick.close,
			entryTime: tick.timestamp,
			entryATR: atrPct || undefined,
			clusterId,
			candlesSinceEntry: 0,
			highSinceEntry: tick.close,
			lowSinceEntry: tick.close,
			lastTickTs: tick.timestamp, // giriş mumu sayaca dahil edilmez
		};
		
		if (exp.isLiveTradingEnabled || config.liveAllExperiments) {
			const bracket = calculateBracketPrices(exp.exitRule, tick.close, side, atrPct);
			this.liveBroker.executeEntry(coin, side, tick.close, bracket.stopPrice, bracket.targetPrice).then(res => {
				if (res.success && this.liveBroker.isLive()) {
					pos.isLive = true;
					pos.liveOrderId = res.orderId;
					pos.stopOrderId = res.stopOrderId;
					pos.takeProfitOrderId = res.takeProfitOrderId;
					if (res.filledPrice) {
						pos.entryPrice = res.filledPrice;
					}
					this.save();
				}
			}).catch(err => logError(String(err)));
		}

		exp.positions.push(pos);
		log(`[EXPERIMENT] ${side === 'short' ? '📉' : '📈'} ${exp.name} | ${coin} ${side.toUpperCase()} @ ${tick.close.toFixed(2)}`);
	}

	private updatePositions(exp: Experiment, coin: string, tick: MarketTick): void {
		const openPos = exp.positions.filter(p => p.coin === coin && !p.exitPrice);

		for (const pos of openPos) {
			// Mum sayacı yalnızca YENİ mumda ilerler — aynı mumun tekrar işlenmesi
			// (diğer coinlerin kapanış tetiklemeleri) sayaçları şişirmez.
			if (pos.lastTickTs !== tick.timestamp) {
				(pos as any).lastTickTs = tick.timestamp;
				pos.candlesSinceEntry++;
			}

			const exit = this.checkExit(exp.exitRule, pos, tick);
			if (exit) {
				this.closePosition(exp, pos, tick, exit.reason, exit.price);
				continue;
			}

			// Uç değerler çıkış kontrolünden SONRA güncellenir. Aksi halde trailing
			// stop, aynı mumun zirvesiyle önce yükseltilip sonra o zirveye göre
			// ölçülür ve mum içindeki geri çekilme görünmez olur (iyimser sapma).
			if (tick.timestamp > pos.entryTime) {
				if (tick.high > pos.highSinceEntry) (pos as any).highSinceEntry = tick.high;
				if (tick.low < pos.lowSinceEntry) (pos as any).lowSinceEntry = tick.low;
			}
		}
	}

	/**
	 * Çıkış kontrolü — mum İÇİ fiyatlarla.
	 *
	 * 4 Ağu düzeltmesi: eskiden yalnızca `tick.close` bakılıyordu. Gerçekte stop
	 * ve hedef borsada BEKLEYEN emirlerdir; fiyat oraya değdiği an çalışırlar.
	 * Kapanışa bakan kod, iğneyle eşiği delip geri dönen mumları görmezden
	 * geliyordu — canlı veride 20 saatte 5 pozisyon bu yüzden açık kalmıştı.
	 * Sonucu: "%1/%1 scalp" deneyi 7 saat pozisyon taşıyor, 5 coinin 5'i de
	 * dolduğu için yeni giriş yapılamıyordu.
	 *
	 * Sapmanın YÖNÜ piyasaya bağlıdır (kaçırılan stop sonucu güzelleştirir,
	 * kaçırılan hedef çirkinleştirir) — 20 saatlik canlı veride aynı girişler
	 * yeniden oynatıldığında 38 yerine 43 kapanış, işlem başına -0.450% yerine
	 * -0.355% çıktı. Kesin olan zarar ölçümde değil AKIŞTA: pozisyonlar
	 * kapanmayınca kadro tıkanıyor ve sistem tasarlandığından az işlem yapıyor.
	 *
	 * Muhafazakâr varsayımlar (mum içi sırayı bilemeyiz):
	 *   • Aynı mumda hem stop hem hedef değdiyse → STOP önce sayılır.
	 *   • Aleyhte boşlukta (gap) dolum eşikten değil, açılıştan yapılır.
	 *   • Lehte boşlukta bonus verilmez — dolum tam hedef fiyatından sayılır.
	 * Giriş mumunun kendi high/low'u kullanılmaz (girişten önceki hareketi içerir).
	 */
	private checkExit(rule: ExitRule, pos: PaperPosition, tick: MarketTick): { reason: string; price: number } | null {
		const isLong = pos.side !== 'short';
		// Giriş mumunda mum içi fiyat yok sayılır → kapanış tek referans
		const intra = tick.timestamp > pos.entryTime;
		const hi = intra ? tick.high : tick.close;
		const lo = intra ? tick.low : tick.close;

		// Aleyhte yön (stop tarafı) ve lehte yön (hedef tarafı) uç fiyatları
		const adverse = isLong ? lo : hi;
		const favorable = isLong ? hi : lo;
		// Aleyhte boşluk koruması: fiyat mum açılışında eşiğin ötesindeyse orada dolar
		const fillStop = (trigger: number) => (isLong ? Math.min(trigger, tick.open) : Math.max(trigger, tick.open));
		const hitStop = (trigger: number) => (isLong ? adverse <= trigger : adverse >= trigger);
		const hitTarget = (trigger: number) => (isLong ? favorable >= trigger : favorable <= trigger);
		const off = (pct: number) => pos.entryPrice * (1 + (isLong ? pct : -pct) / 100);

		switch (rule.type) {
			case 'fixed_candles':
				if (pos.candlesSinceEntry >= rule.n) return { reason: 'fixed_exit', price: tick.close };
				return null;

			case 'stop_loss': {
				const s = off(-rule.percent);
				return hitStop(s) ? { reason: 'stop_loss', price: fillStop(s) } : null;
			}

			case 'take_profit': {
				const t = off(rule.percent);
				return hitTarget(t) ? { reason: 'take_profit', price: t } : null;
			}

			case 'stop_and_target': {
				const s = off(-rule.stopPercent);
				const t = off(rule.targetPercent);
				// Sıra bilinmiyor → kötü senaryo: stop önce
				if (hitStop(s)) return { reason: 'stop_loss', price: fillStop(s) };
				if (hitTarget(t)) return { reason: 'take_profit', price: t };
				return null;
			}

			case 'stop_and_target_atr': {
				// ATR bazlı stop/target: pozisyon açılırken kaydedilen entryATR kullanılır.
				// Pozisyon süresince ATR değişse bile stop/target sabit kalır (çapa etkisi).
				const atrPct = pos.entryATR || 1; // fallback: %1 (eski pozisyonlar için)
				const stopPct = atrPct * rule.stopMultiplier;
				const targetPct = atrPct * rule.targetMultiplier;
				const s = off(-stopPct);
				const t = off(targetPct);
				if (hitStop(s)) return { reason: 'stop_loss', price: fillStop(s) };
				if (hitTarget(t)) return { reason: 'take_profit', price: t };
				return null;
			}

			case 'trailing_stop': {
				// Tetik, ÖNCEKİ zirveye/dibe göre hesaplanır (bu mumun ucu henüz işlenmedi)
				const peak = isLong ? pos.highSinceEntry : pos.lowSinceEntry;
				const trigger = isLong ? peak * (1 - rule.percent / 100) : peak * (1 + rule.percent / 100);
				return hitStop(trigger) ? { reason: 'trailing_stop', price: fillStop(trigger) } : null;
			}

			default:
				return null;
		}
	}

	private closePosition(exp: Experiment, pos: PaperPosition, tick: MarketTick, reason: string, exitPrice = tick.close): void {
		const sign = pos.side === 'short' ? -1 : 1;
		(pos as any).exitPrice = exitPrice;
		(pos as any).exitTime = tick.timestamp;
		(pos as any).exitReason = reason;
		// Net PnL = yönlü brüt getiri - gidiş/dönüş işlem maliyeti
		(pos as any).pnlPercent = sign * ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 - ROUND_TRIP_COST_PCT;

		const pnl = pos.pnlPercent!;
		const emoji = pnl >= 0 ? '🟢' : '🔴';
		log(`[EXPERIMENT] ${emoji} ${exp.name} | ${pos.coin} CLOSE @ ${exitPrice.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}% | Reason: ${reason}`);

		if (exp.isLiveTradingEnabled || config.liveAllExperiments || pos.isLive) {
			const estimatedPnlUsd = (pnl / 100) * config.risk.maxTradeSizeUsd;
			this.liveBroker
				.executeExit(pos.coin, pos.side, exitPrice, estimatedPnlUsd, pos.stopOrderId, pos.takeProfitOrderId)
				.catch(err => logError(String(err)));
		}

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

	/**
	 * POPÜLASYON TABANI — organizmanın açlıktan ölmesini engeller.
	 *
	 * 1 Ağu raporunun teşhisi: ölüm oranı vardı, doğum oranı YOKTU.
	 * Deneyler ya süresi dolunca kapanıyor (closeExperiment) ya da Evolver
	 * tarafından öldürülüyordu; yerine yenisi yalnızca kontroller için
	 * doğuyordu. Evolver'ın sentez kuralları da tek atışlıktır. Sonuç:
	 * popülasyon tek yönlü azalıp SIFIRA indi — "Çalışan deney yok".
	 *
	 * Çözüm: çekirdek kadro (createDefaultExperiments) daimî bir hipotez
	 * setidir. Bir üyesinin çalışan örneği kalmadıysa yeni nesli doğar.
	 * Bu bilimsel olarak da doğrudur: temmuz ayısında ölen bir kural,
	 * ağustos boğasında yeniden sınanmayı hak eder — her neslin istatistiği
	 * ayrı tutulduğu ve ölen neslin kaydı bilgi grafiğinde kaldığı için
	 * geçmiş sonuç kaybolmaz.
	 *
	 * [SYNTH]/[CROSS] deneyleri bu kadroda DEĞİLDİR: onlar belirli
	 * koşullardan doğar ve ölümleri doğal seçilimdir.
	 */
	private ensureCorePopulation(): void {
		const COOLDOWN_MS = 6 * 60 * 60 * 1000; // ölen neslin ardından dinlenme süresi
		const now = Date.now();
		let spawned = 0;

		for (const template of createDefaultExperiments()) {
			const sameName = this.experiments.filter((e) => e.name === template.name);
			if (sameName.some((e) => e.status === 'running')) continue;

			// Son nesil çok yeni öldüyse hemen diriltme (kill→respawn savrulması olmasın)
			const lastEnd = Math.max(0, ...sameName.map((e) => e.endedAt || 0));
			if (lastEnd > 0 && now - lastEnd < COOLDOWN_MS) continue;

			this.experiments.push({ ...template, id: randomUUID(), startedAt: now });
			log(`[EXPERIMENT] 🌱 Yeni nesil doğdu: "${template.name}"`);
			spawned++;
		}

		if (spawned > 0) {
			log(`[EXPERIMENT] Popülasyon tabanı korundu: ${spawned} deney yeniden doğdu.`);
			this.save();
		}
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

		// Mükerrer isim temizliği — KRİTİK DÜZELTME: Sadece AYNI statüdeki (status) deneyler tekilleştirilir.
		// Asla tamamlanmış bir arşiv kaydı, çalışan aktif bir nesli silemez (10 işlemin silinme bug'ı önlendi).
		const byKey = new Map<string, Experiment>();
		for (const e of this.experiments) {
			const key = `${e.name}:${e.status}`;
			const prev = byKey.get(key);
			if (!prev) {
				byKey.set(key, e);
			} else {
				const keep = e.stats.totalTrades >= prev.stats.totalTrades ? e : prev;
				byKey.set(key, keep);
				log(`[EXPERIMENT] 🧹 Mükerrer deney temizlendi: "${e.name}" (${e.status})`);
				changed = true;
			}
		}
		if (changed) this.experiments = [...byKey.values()];

		// Mevcut deneylere maxConcurrentPositions = 3 kotasını uygula
		for (const e of this.experiments) {
			if (!e.maxConcurrentPositions) {
				e.maxConcurrentPositions = 3;
				changed = true;
			}
		}

		// ── Öksüz kontrol dirilişi ──
		// Ölümsüzlük düzeltmesinden ÖNCE ölmüş kontroller donmuş kalıyordu.
		// Sonuç (24 Tem raporu): adaylar son 3 günün düşüşünde işlem yaparken
		// kontroller 18 Tem'de donmuştu → "adaylar rastgeleyi geçemedi" verdikti
		// farklı dönemleri kıyaslayan GEÇERSİZ bir sonuçtu. Kontrol her zaman
		// adaylarla AYNI piyasada koşmalı, yoksa kıyas anlamını yitirir.
		const orphans = new Map<string, Experiment>();
		for (const e of this.experiments) {
			if (!isControlExperiment(e.name) || e.status === 'running') continue;
			const hasLiveTwin = this.experiments.some(
				(x) => x.name === e.name && x.status === 'running',
			);
			if (!hasLiveTwin) orphans.set(e.name, e);
		}
		for (const orphan of orphans.values()) {
			this.respawnControl(orphan);
			changed = true;
		}

		if (changed) this.save();
	}

	private save(): void {
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(EXPERIMENTS_FILE, JSON.stringify(this.experiments, null, 2));
	}
}
