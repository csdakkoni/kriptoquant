// ============================================================================
// EVOLVER: EŞİKLER + KANITTAN DENEY DOĞUMU
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
import { ObservationScoreboard } from '../src/organism/observation-scoreboard.js';
import type { Observation, MarketTick } from '../src/organism/types.js';

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
	return { evolver: new Evolver(graph, runner), runner, graph };
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
		evolver.evolve(new ObservationScoreboard());
		expect(exp.promoted, 'terfi etmeliydi').toBe(true);
		expect(exp.status, 'terfi ederken aynı anda öldürüldü').toBe('running');
	});

	it('işlem başına kaybettiren deney ölmeli', () => {
		const exp = mkExp('Kötü Deney', 30, -1.0);
		const { evolver } = setup([exp]);
		evolver.evolve(new ObservationScoreboard());
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
		evolver.evolve(new ObservationScoreboard());
		expect(exp.status, 'başabaşa yakın deney ölçek yüzünden öldürüldü').toBe('running');
	});

	it('az işlemli deney verdikt almadan bekletilmeli', () => {
		const exp = mkExp('Az İşlemli', 5, -2.0);
		const { evolver } = setup([exp]);
		evolver.evolve(new ObservationScoreboard());
		expect(exp.status, 'yetersiz örneklemle verdikt verildi').toBe('running');
		expect(exp.promoted).toBeFalsy();
	});
});

describe('Evolver: kontroller dokunulmaz', () => {
	it('çok kaybeden bir KONTROL bile öldürülmemeli', () => {
		const ctrl = mkExp('Random + Stop/Target (1%/2%)', 100, -2.0);
		const { evolver } = setup([ctrl]);
		evolver.evolve(new ObservationScoreboard());
		expect(ctrl.status, 'kontrol grubu öldürüldü — kıyas tabanı yok olur').toBe('running');
	});

	it('çok kazanan bir KONTROL terfi de etmemeli', () => {
		const ctrl = mkExp('Random SHORT + Stop/Target (1%/2%)', 100, 2.0);
		const { evolver } = setup([ctrl]);
		evolver.evolve(new ObservationScoreboard());
		expect(ctrl.promoted, 'kontrol grubu aday ilan edildi').toBeFalsy();
	});
});

// ============================================================================
// KANIT → DENEY DOĞUMU
// ============================================================================
// 4 Ağu: gözlem karnesi 20 saat boyunca ölçüm yaptı ama hiçbir karara
// dokunmadı — kullanıcının deyimiyle "ekranda bir şeyler yazmasının anlamı
// yok". Elle yazılmış 6 sentez kuralı kaldırıldı; artık deneyler yalnızca
// karnenin ölçtüğü kanıttan doğar. Bu testler o bağın kopmamasını sağlar.
// ============================================================================

const CANDLE = 900_000;

/** Karneyi, verilen tipte belirli bir forward getiri görmüş gibi doldurur */
function scoreboardWith(type: string, horizon: number, retPct: number, n: number): ObservationScoreboard {
	const sb = new ObservationScoreboard();
	const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
	let ts = 1_700_000_000_000;

	for (let i = 0; i < n; i++) {
		const coin = coins[i % coins.length];
		// Gözlem anı: fiyat 100
		const at = ts + i * (horizon + 10) * CANDLE;
		const before: MarketTick[] = [{ coin, timestamp: at, open: 100, high: 100, low: 100, close: 100, volume: 1, interval: '15m' }];
		const obs: Observation = {
			id: `o${i}`, type: type as any, description: 'test', confidence: 1,
			coins: [coin], timestamp: at, relatedData: {},
		};
		sb.record([obs], new Map([[coin, before]]));
		// Fiyat SADECE hedef vadede hareket etsin; daha kısa vadeler düz kalsın.
		// Aksi halde tek bir mum tüm ufuklara aynı getiriyi yazar ve test,
		// kodun vadeyi gerçekten kanıttan aldığını ölçemez.
		const after: MarketTick[] = [...before];
		for (const h of [4, 16, 48, 96, 192]) {
			if (h > horizon) break;
			const close = h === horizon ? 100 * (1 + retPct / 100) : 100;
			after.push({ coin, timestamp: at + h * CANDLE, open: 100, high: 100, low: 100, close, volume: 1, interval: '15m' });
		}
		sb.update(new Map([[coin, after]]));
	}
	return sb;
}

describe('Gözlem karnesi karar veriyor mu', () => {
	it('kanıtlanmış POZİTİF kenar, LONG deney doğurmalı', () => {
		const { evolver, runner } = setup([]);
		evolver.evolve(scoreboardWith('divergence', 4, 1.2, 40));
		const born = runner.getExperiments().filter(e => e.name.startsWith('[KANIT]'));
		expect(born.length, 'karne kanıt buldu ama deney doğmadı — bağ yine kopuk').toBe(1);
		expect(born[0].side).toBe('long');
		expect(born[0].entryRule).toMatchObject({ type: 'on_observation', observationType: 'divergence' });
	});

	it('deneyin GİRİŞİ ve TUTMA SÜRESİ kanıtla aynı olmalı (isim-kural uyumsuzluğu olmasın)', () => {
		const { evolver, runner } = setup([]);
		evolver.evolve(scoreboardWith('volatility_squeeze', 16, 0.9, 40));
		const born = runner.getExperiments().find(e => e.name.startsWith('[KANIT]'))!;
		// Eski sistemin hatası: "Hacim Patlaması" adlı deney 'divergence'a bağlıydı
		expect((born.entryRule as any).observationType, 'giriş sinyali kanıtın tipi değil').toBe('volatility_squeeze');
		expect((born.exitRule as any).n, 'tutma süresi kanıtın vadesi değil').toBe(16);
	});

	it('kanıtlanmış NEGATİF kenar, SHORT deney doğurmalı', () => {
		const { evolver, runner } = setup([]);
		evolver.evolve(scoreboardWith('surprise', 4, -1.1, 40));
		const born = runner.getExperiments().find(e => e.name.startsWith('[KANIT]'))!;
		expect(born?.side, 'tutarlı düşüren sinyal short olarak denenmedi').toBe('short');
	});

	it('maliyeti aşmayan zayıf kenardan deney DOĞMAMALI', () => {
		const { evolver, runner } = setup([]);
		evolver.evolve(scoreboardWith('silence', 4, 0.2, 40)); // %0.3 maliyetin altında
		expect(runner.getExperiments().filter(e => e.name.startsWith('[KANIT]')).length,
			'maliyeti aşmayan sinyalden deney doğdu — para kaybettirir').toBe(0);
	});

	it('örneklemi yetersiz kanıttan deney DOĞMAMALI', () => {
		const { evolver, runner } = setup([]);
		evolver.evolve(scoreboardWith('herd', 4, 2.0, 8)); // güçlü ama n=8
		expect(runner.getExperiments().filter(e => e.name.startsWith('[KANIT]')).length,
			'8 ölçümle şans ayırt edilemez').toBe(0);
	});

	it('aynı kanıt iki kez deney doğurmamalı', () => {
		const { evolver, runner } = setup([]);
		const sb = scoreboardWith('divergence', 4, 1.2, 40);
		evolver.evolve(sb);
		evolver.evolve(sb);
		expect(runner.getExperiments().filter(e => e.name.startsWith('[KANIT]')).length).toBe(1);
	});
});
