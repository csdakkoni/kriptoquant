// ============================================================================
// EVOLVER EŞİKLERİ + GÜNLÜK TESTLERİ
// ============================================================================
// 3 Ağu denetiminde bulunan üç saçmalığı sabitler:
//   1. Terfi ve öldürme aynı geçişte birlikte tetiklenebiliyordu
//   2. Öldürme eşiği TOPLAM yüzdeye bakıyordu → işlem sayısı arttıkça
//      kaliteden bağımsız ölüm (1 Ağu toplu yok oluşu)
//   3. Günlükte hafta etiketi ayın haftasını yılın haftası gibi yazıyordu
// ============================================================================

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Evolver } from '../src/organism/evolver.js';
import { ExperimentRunner, type Experiment } from '../src/organism/experiment-runner.js';
import { KnowledgeGraph } from '../src/organism/knowledge-graph.js';
import { ResearchJournal } from '../src/organism/journal.js';
import type { Assumption } from '../src/organism/types.js';

function mkExp(name: string, trades: number, avgPnl: number, over: Partial<Experiment> = {}): Experiment {
	const total = avgPnl * trades;
	return {
		id: `id-${name}`,
		name,
		hypothesis: 'test',
		entryRule: { type: 'random', probability: 0.05 },
		exitRule: { type: 'fixed_candles', n: 5 },
		coins: ['BTCUSDT'],
		status: 'running',
		startedAt: Date.now(),
		maxDurationHours: 168,
		positions: [],
		closedPositions: [],
		stats: {
			totalTrades: trades,
			wins: Math.round(trades * 0.5),
			losses: trades - Math.round(trades * 0.5),
			totalPnlPercent: total,
			avgPnlPercent: avgPnl,
			winRate: 50,
			avgWinPercent: 1,
			avgLossPercent: -1,
			// Eski kodu tetikleyecek kadar yüksek drawdown — yeni eşik buna bakmamalı
			maxDrawdownPercent: 25,
		},
		...over,
	};
}

function setup(exps: Experiment[]) {
	const graph = new KnowledgeGraph();
	const runner = new ExperimentRunner(graph);
	const list = runner.getExperiments();
	list.length = 0;
	list.push(...exps);
	return { evolver: new Evolver(graph, runner), runner };
}

beforeEach(() => {
	const dir = process.env.ORGANISM_DATA_DIR!;
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => {
	const dir = process.env.ORGANISM_DATA_DIR!;
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('Evolver: terfi ve öldürme birbirini dışlar', () => {
	it('bir deney AYNI ANDA hem terfi hem ölmemeli', () => {
		// İşlem başına iyi ama drawdown yüksek: eski kodda ikisi de tetiklenirdi
		const exp = mkExp('İyi Deney', 30, 0.5);
		const { evolver } = setup([exp]);
		evolver.evolve([]);
		expect(exp.promoted, 'terfi etmeliydi').toBe(true);
		expect(exp.status, 'terfi ederken aynı anda öldürüldü').toBe('running');
	});

	it('işlem başına kaybettiren deney ölmeli', () => {
		const exp = mkExp('Kötü Deney', 30, -1.0);
		const { evolver } = setup([exp]);
		evolver.evolve([]);
		expect(exp.status, 'sistematik kaybeden deney yaşamaya devam etti').toBe('failed');
		expect(exp.promoted).toBeFalsy();
	});
});

describe('Evolver: öldürme eşiği ölçekten bağımsız olmalı (1 Ağu toplu yok oluş)', () => {
	it('işlem başına başabaşa yakın deney, çok işlem yaptı diye ÖLMEMELİ', () => {
		// 200 işlem × -%0.05 = -10 toplam puan, 25 puan drawdown.
		// Eski eşikler (maxLoss -5, maxDrawdown 8) bunu anında öldürürdü.
		const exp = mkExp('Çok İşlemli Nötr', 200, -0.05);
		const { evolver } = setup([exp]);
		evolver.evolve([]);
		expect(exp.status, 'başabaşa yakın deney ölçek yüzünden öldürüldü').toBe('running');
	});

	it('az işlemli deney verdikt almadan bekletilmeli', () => {
		const exp = mkExp('Az İşlemli', 5, -2.0);
		const { evolver } = setup([exp]);
		evolver.evolve([]);
		expect(exp.status, 'yetersiz örneklemle verdikt verildi').toBe('running');
		expect(exp.promoted).toBeFalsy();
	});
});

describe('Evolver: kontroller dokunulmaz', () => {
	it('çok kaybeden bir KONTROL bile öldürülmemeli', () => {
		const ctrl = mkExp('Random + Stop/Target (1%/2%)', 100, -2.0);
		const { evolver } = setup([ctrl]);
		evolver.evolve([]);
		expect(ctrl.status, 'kontrol grubu öldürüldü — kıyas tabanı yok olur').toBe('running');
	});

	it('çok kazanan bir KONTROL terfi de etmemeli', () => {
		const ctrl = mkExp('Random SHORT + Stop/Target (1%/2%)', 100, 2.0);
		const { evolver } = setup([ctrl]);
		evolver.evolve([]);
		expect(ctrl.promoted, 'kontrol grubu aday ilan edildi').toBeFalsy();
	});
});

describe('Araştırma günlüğü', () => {
	const mkAssumption = (over: Partial<Assumption> = {}): Assumption => ({
		id: 'a1',
		statement: 'Test varsayımı',
		nullHypothesis: 'n',
		testMethod: 't',
		status: 'testing',
		evidence: [],
		createdAt: Date.now(),
		confidenceToKill: 0.7,
		...over,
	});

	it('hafta etiketi ISO formatında ve makul olmalı (ayın haftası DEĞİL)', () => {
		const graph = new KnowledgeGraph();
		const entry = new ResearchJournal(graph).generateEntry([mkAssumption()]);
		expect(entry.week).toMatch(/^\d{4}-W\d{2}$/);
		const weekNo = Number(entry.week.split('-W')[1]);
		// Eski hata ayın haftasını üretiyordu → 1-5 arası takılıp kalıyordu
		expect(weekNo).toBeGreaterThanOrEqual(1);
		expect(weekNo).toBeLessThanOrEqual(53);
		// Ayın haftası hesabı yılın ikinci yarısında bile 1-5 arasında takılırdı
		expect(weekNo, 'hafta numarası ayın haftası gibi görünüyor').toBeGreaterThanOrEqual(
			new Date().getUTCMonth() >= 6 ? 20 : 1,
		);
	});

	it('insights alanı bilgi grafiğinden dolmalı (eskiden hep boştu)', () => {
		const graph = new KnowledgeGraph();
		graph.addInsight('Test iç görüsü: maliyet her şeyi belirler', []);
		const entry = new ResearchJournal(graph).generateEntry([mkAssumption()]);
		expect(entry.insights.length, 'insights hâlâ boş — ölü alan').toBeGreaterThan(0);
		expect(entry.insights[0]).toContain('Test iç görüsü');
	});

	it('günlük dosyası diske yazılmalı', () => {
		const graph = new KnowledgeGraph();
		const entry = new ResearchJournal(graph).generateEntry([mkAssumption()]);
		const f = join(process.env.ORGANISM_DATA_DIR!, 'journal', `${entry.date}.json`);
		expect(existsSync(f), 'günlük kaydedilmedi').toBe(true);
		expect(JSON.parse(readFileSync(f, 'utf-8')).date).toBe(entry.date);
	});
});
