// ============================================================================
// ÇALIŞMA-ZAMANI DAVRANIŞ TESTLERİ
// ============================================================================
// ExperimentRunner'ı sentetik mumlarla gerçekten çalıştırır ve şunları
// doğrular: yön bütünlüğü, rejim eşlemesi, maliyet düşümü, çıkış kuralları,
// mum başına tek giriş. Hepsi canlıda hata yapmış davranışlar.
// ============================================================================

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { ExperimentRunner, type Experiment, type PaperPosition } from '../src/organism/experiment-runner.js';
import { KnowledgeGraph } from '../src/organism/knowledge-graph.js';
import type { MarketTick } from '../src/organism/types.js';
import type { MarketRegime } from '../src/organism/regime.js';

const CANDLE_MS = 900_000;
const COIN = 'BTCUSDT';

/** Belirtilen kapanış fiyatlarından sentetik mum serisi üretir */
function makeTicks(closes: number[], startTs = 1_700_000_000_000): MarketTick[] {
	return closes.map((c, i) => ({
		coin: COIN,
		timestamp: startTs + i * CANDLE_MS,
		open: i === 0 ? c : closes[i - 1],
		high: Math.max(c, i === 0 ? c : closes[i - 1]),
		low: Math.min(c, i === 0 ? c : closes[i - 1]),
		close: c,
		volume: 1000,
		interval: '15m',
	}));
}

function mkExperiment(over: Partial<Experiment>): Experiment {
	return {
		id: 'test-exp',
		name: 'TEST Deney',
		hypothesis: 'test',
		entryRule: { type: 'always_long' },
		exitRule: { type: 'fixed_candles', n: 2 },
		coins: [COIN],
		status: 'running',
		startedAt: Date.now(),
		maxDurationHours: 168,
		positions: [],
		closedPositions: [],
		stats: {
			totalTrades: 0, wins: 0, losses: 0, totalPnlPercent: 0,
			avgPnlPercent: 0, winRate: 0, avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0,
		},
		...over,
	};
}

/** Sadece verilen deneyi içeren, izole bir runner kurar */
function setupRunner(exp: Experiment, regime: MarketRegime = 'BULL') {
	const runner = new ExperimentRunner(new KnowledgeGraph());
	runner.setRegimeProvider(() => regime);
	const list = runner.getExperiments();
	list.length = 0; // varsayılan kadroyu çıkar — test tek deneye odaklansın
	list.push(exp);
	return runner;
}

/** Mumları sırayla runner'a besler (canlı akışı taklit eder) */
function feed(runner: ExperimentRunner, ticks: MarketTick[], upto = ticks.length) {
	for (let i = 1; i <= upto; i++) {
		runner.processTick(new Map([[COIN, ticks.slice(0, i)]]), []);
	}
}

beforeEach(() => {
	const dir = process.env.ORGANISM_DATA_DIR!;
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
	const dir = process.env.ORGANISM_DATA_DIR!;
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('Yön bütünlüğü (3 Ağu bug: LONG stratejisi SHORT pozisyon tutuyordu)', () => {
	it("side:'long' deney ASLA short pozisyon açmamalı", () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 3 } });
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 101, 99, 102, 98, 103, 97]));

		const all = [...exp.positions, ...exp.closedPositions];
		expect(all.length, 'hiç pozisyon açılmadı').toBeGreaterThan(0);
		for (const p of all) expect(p.side, 'long deney short açtı!').toBe('long');
	});

	it("side:'short' deney ASLA long pozisyon açmamalı", () => {
		const exp = mkExperiment({ side: 'short', exitRule: { type: 'fixed_candles', n: 3 } });
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 101, 99, 102, 98, 103, 97]));

		const all = [...exp.positions, ...exp.closedPositions];
		expect(all.length).toBeGreaterThan(0);
		for (const p of all) expect(p.side, 'short deney long açtı!').toBe('short');
	});
});

describe('Rejim eşlemesi (BULL→long, BEAR→short, CHOP→nakit)', () => {
	it('BULL rejimde long açmalı', () => {
		const exp = mkExperiment({ side: 'regime' });
		const runner = setupRunner(exp, 'BULL');
		feed(runner, makeTicks([100, 101, 102, 103]));
		const all = [...exp.positions, ...exp.closedPositions];
		expect(all.length).toBeGreaterThan(0);
		expect(all.every((p) => p.side === 'long')).toBe(true);
	});

	it('BEAR rejimde short açmalı', () => {
		const exp = mkExperiment({ side: 'regime' });
		const runner = setupRunner(exp, 'BEAR');
		feed(runner, makeTicks([100, 101, 102, 103]));
		const all = [...exp.positions, ...exp.closedPositions];
		expect(all.length).toBeGreaterThan(0);
		expect(all.every((p) => p.side === 'short')).toBe(true);
	});

	it('CHOP rejimde HİÇ pozisyon açmamalı (nakit)', () => {
		const exp = mkExperiment({ side: 'regime' });
		const runner = setupRunner(exp, 'CHOP');
		feed(runner, makeTicks([100, 101, 102, 103, 104, 105]));
		expect([...exp.positions, ...exp.closedPositions].length, 'CHOP\'ta pozisyon açıldı').toBe(0);
	});

	it('UNKNOWN rejimde de pozisyon açmamalı', () => {
		const exp = mkExperiment({ side: 'regime' });
		const runner = setupRunner(exp, 'UNKNOWN');
		feed(runner, makeTicks([100, 101, 102, 103]));
		expect([...exp.positions, ...exp.closedPositions].length).toBe(0);
	});
});

describe('Maliyet düşümü — her kapanan işlemde', () => {
	it('fiyat hiç değişmese bile kapanan işlem maliyeti yansıtmalı', () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 2 } });
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 100, 100, 100, 100]));

		expect(exp.closedPositions.length, 'işlem kapanmadı').toBeGreaterThan(0);
		for (const p of exp.closedPositions) {
			expect(p.pnlPercent, 'maliyet düşülmemiş').toBeCloseTo(-0.3, 6);
		}
	});

	it('kâr eden işlemde bile maliyet düşülmüş olmalı', () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 2 } });
		const runner = setupRunner(exp);
		// 100 → 110 (%10 brüt), net %9.7 olmalı
		feed(runner, makeTicks([100, 105, 110, 110, 110]));
		const first = exp.closedPositions[0];
		expect(first).toBeTruthy();
		const gross = ((first.exitPrice! - first.entryPrice) / first.entryPrice) * 100;
		expect(first.pnlPercent!).toBeCloseTo(gross - 0.3, 6);
	});
});

describe('Çıkış kuralları', () => {
	it('stop_and_target: hedefe ulaşınca kâr al ile kapanmalı', () => {
		const exp = mkExperiment({
			side: 'long',
			exitRule: { type: 'stop_and_target', stopPercent: 5, targetPercent: 2 },
		});
		const runner = setupRunner(exp);
		// 101'den girer; hedef 101×1.02 = 103.02 → 105 bunu net aşar
		feed(runner, makeTicks([100, 101, 105, 105]));
		const tp = exp.closedPositions.find((p) => p.exitReason === 'take_profit');
		expect(tp, 'hedefe ulaşıldı ama kâr al tetiklenmedi').toBeTruthy();
		expect(tp!.pnlPercent!).toBeGreaterThan(0);
	});

	it('stop_and_target: stop seviyesine düşünce zarar kes ile kapanmalı', () => {
		const exp = mkExperiment({
			side: 'long',
			exitRule: { type: 'stop_and_target', stopPercent: 2, targetPercent: 10 },
		});
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 99, 97, 97]));
		const sl = exp.closedPositions.find((p) => p.exitReason === 'stop_loss');
		expect(sl, 'stop seviyesi delindi ama kapanmadı').toBeTruthy();
		expect(sl!.pnlPercent!).toBeLessThan(0);
	});

	it('short pozisyon fiyat DÜŞÜNCE kâr al ile kapanmalı', () => {
		const exp = mkExperiment({
			side: 'short',
			exitRule: { type: 'stop_and_target', stopPercent: 5, targetPercent: 2 },
		});
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 99, 97, 97]));
		const tp = exp.closedPositions.find((p) => p.exitReason === 'take_profit');
		expect(tp, 'short kâra geçti ama kapanmadı').toBeTruthy();
		expect(tp!.pnlPercent!).toBeGreaterThan(0);
	});

	it('fixed_candles: belirtilen mum sayısında kapanmalı', () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 3 } });
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 100, 100, 100, 100, 100]));
		const closed = exp.closedPositions[0];
		expect(closed).toBeTruthy();
		expect(closed.candlesSinceEntry, 'mum sayacı yanlış').toBe(3);
	});
});

describe('Giriş kapısı (10x tik şişmesi bug\'ı)', () => {
	it('aynı mum tekrar işlenirse ikinci pozisyon açılmamalı', () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 99 } });
		const runner = setupRunner(exp);
		const ticks = makeTicks([100, 101]);

		// Aynı mumu 10 kez besle (10 coinin kapanışını taklit eder)
		for (let i = 0; i < 10; i++) {
			runner.processTick(new Map([[COIN, ticks]]), []);
		}
		expect(exp.positions.length, 'aynı mumda birden fazla pozisyon açıldı').toBeLessThanOrEqual(1);
	});

	it('bir coinde aynı anda birden fazla açık pozisyon olmamalı', () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 99 } });
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 101, 102, 103, 104, 105, 106]));
		const open = exp.positions.filter((p) => !p.exitPrice);
		expect(open.length, 'aynı coinde çoklu açık pozisyon').toBeLessThanOrEqual(1);
	});
});

describe('İstatistik tutarlılığı', () => {
	it('stats kapanan işlemlerle birebir uyuşmalı', () => {
		const exp = mkExperiment({ side: 'long', exitRule: { type: 'fixed_candles', n: 2 } });
		const runner = setupRunner(exp);
		feed(runner, makeTicks([100, 101, 102, 101, 100, 99, 100, 101]));

		const closed = exp.closedPositions;
		expect(closed.length).toBeGreaterThan(0);
		expect(exp.stats.totalTrades, 'işlem sayısı uyuşmuyor').toBe(closed.length);

		const sum = closed.reduce((s, p) => s + (p.pnlPercent ?? 0), 0);
		expect(exp.stats.totalPnlPercent, 'toplam PnL uyuşmuyor').toBeCloseTo(sum, 6);

		const wins = closed.filter((p) => (p.pnlPercent ?? 0) > 0).length;
		expect(exp.stats.wins).toBe(wins);
		expect(exp.stats.winRate).toBeCloseTo((wins / closed.length) * 100, 6);
	});
});

describe('Popülasyon tabanı (1 Ağu: sıfır deneye düştü)', () => {
	it('yeni runner en az bir çalışan deneyle başlamalı', () => {
		const runner = new ExperimentRunner(new KnowledgeGraph());
		const running = runner.getExperiments().filter((e) => e.status === 'running');
		expect(running.length, 'organizma boş kadroyla doğdu').toBeGreaterThan(0);
	});

	it('tüm deneyler ölürse popülasyon kendini yenilemeli', () => {
		const runner = new ExperimentRunner(new KnowledgeGraph());
		const list = runner.getExperiments();
		// Hepsini öldür + cooldown'ı geçmiş göster
		for (const e of list) {
			e.status = 'failed';
			e.endedAt = Date.now() - 24 * 60 * 60 * 1000;
		}
		expect(list.filter((e) => e.status === 'running').length).toBe(0);

		// Yeni runner (yeniden başlatma) popülasyonu diriltmeli
		const runner2 = new ExperimentRunner(new KnowledgeGraph());
		const running2 = runner2.getExperiments().filter((e) => e.status === 'running');
		expect(running2.length, 'ölü organizma dirilmedi').toBeGreaterThan(0);
	});
});
