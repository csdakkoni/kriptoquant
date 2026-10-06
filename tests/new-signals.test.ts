// ============================================================================
// YENİ SİNYALLER: piyasaya göre karne, funding gözlemcisi, günlük kırılım
// ============================================================================

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObservationScoreboard, marketReturnPct } from '../src/organism/observation-scoreboard.js';
import { FundingExtremeObserver } from '../src/organism/observers.js';
import { dailyCandles } from '../src/organism/daily-candles.js';
import { ExperimentRunner, type Experiment } from '../src/organism/experiment-runner.js';
import { KnowledgeGraph } from '../src/organism/knowledge-graph.js';
import type { MarketTick, Observation } from '../src/organism/types.js';

const C = 900_000;
const T0 = 1_700_000_000_000;
const dir = process.env.ORGANISM_DATA_DIR!;

beforeEach(() => {
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => {
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const tick = (coin: string, i: number, close: number): MarketTick => ({
	coin, timestamp: T0 + i * C, open: close, high: close, low: close, close, volume: 1, interval: '15m',
});

describe('Gözlem karnesi piyasaya göre ölçer', () => {
	it('bütün piyasa %2 yükselirken %2 yükselen coin için göreli getiri 0 olmalı', () => {
		const coins = ['A', 'B', 'C', 'D', 'E', 'F'];
		const series = new Map<string, MarketTick[]>(
			coins.map((c) => [c, Array.from({ length: 5 }, (_, i) => tick(c, i, i === 4 ? 102 : 100))]),
		);
		expect(marketReturnPct(series, T0, T0 + 4 * C)).toBeCloseTo(2, 6);

		const sb = new ObservationScoreboard();
		const obs: Observation = { id: 'o', type: 'divergence', description: '', confidence: 1, coins: ['A'], timestamp: T0, relatedData: {} };
		sb.record([obs], new Map([['A', [tick('A', 0, 100)]]]));
		sb.update(series);
		const saved = JSON.parse(readFileSync(join(dir, 'observation-scoreboard.json'), 'utf-8'));
		expect(saved.scores.divergence['4'].n).toBe(1);
		expect(saved.scores.divergence['4'].sumRet, 'piyasanın yükselişi sinyal sanıldı').toBeCloseTo(0, 6);
	});

	it('piyasa verisi yetersizse ölçüm yapılmamalı', () => {
		const series = new Map([['A', [tick('A', 0, 100), tick('A', 4, 102)]]]);
		expect(marketReturnPct(series, T0, T0 + 4 * C)).toBeUndefined();
	});
});

describe('Funding gözlemcisi', () => {
	const candles = (ts: number) => new Map([['BTCUSDT', [{ ...tick('BTCUSDT', 0, 100), timestamp: ts }]]]);

	it('yüksek funding bir kez "kalabalık long" gözlemi üretmeli', () => {
		const rec = { time: T0, rate: 0.0005 };
		const obs = new FundingExtremeObserver(() => rec);
		const first = obs.observe(candles(T0));
		expect(first.map((o) => o.type)).toEqual(['funding_crowded_long']);
		expect(obs.observe(candles(T0 + C)), 'aynı funding kaydı ikinci kez sayıldı').toHaveLength(0);
	});

	it('normal funding gözlem üretmemeli, eski kayıt da sayılmamalı', () => {
		expect(new FundingExtremeObserver(() => ({ time: T0, rate: 0.0001 })).observe(candles(T0))).toHaveLength(0);
		const stale = new FundingExtremeObserver(() => ({ time: T0, rate: 0.001 }));
		expect(stale.observe(candles(T0 + 8 * 4 * C)), 'saatler önceki oran yeniden başlatmada sayıldı').toHaveLength(0);
	});

	it('negatif funding "kalabalık short" gözlemi üretmeli', () => {
		const o = new FundingExtremeObserver(() => ({ time: T0, rate: -0.0003 })).observe(candles(T0));
		expect(o[0]?.type).toBe('funding_crowded_short');
	});
});

describe('Günlük trend kırılımı', () => {
	it('fiyat 20 günün zirvesini YUKARI kestiğinde bir kez long açmalı', () => {
		dailyCandles.set('BTCUSDT', Array.from({ length: 20 }, (_, i) => ({ openTime: i, high: i === 7 ? 110 : 105, close: 100 })));
		const exp: Experiment = {
			id: 'd', name: 'Günlük Test', hypothesis: '', entryRule: { type: 'daily_breakout', lookbackDays: 20 },
			exitRule: { type: 'trailing_stop', percent: 10 }, coins: ['BTCUSDT'], status: 'running',
			startedAt: Date.now(), maxDurationHours: 720, positions: [], closedPositions: [],
			stats: { totalTrades: 0, wins: 0, losses: 0, totalPnlPercent: 0, avgPnlPercent: 0, winRate: 0, avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0 },
		};
		const runner = new ExperimentRunner(new KnowledgeGraph());
		const list = runner.getExperiments();
		list.length = 0;
		list.push(exp);

		const closes = [108, 109, 111, 112];
		const ticks = closes.map((c, i) => tick('BTCUSDT', i, c));
		for (let i = 1; i <= ticks.length; i++) runner.processTick(new Map([['BTCUSDT', ticks.slice(0, i)]]), []);

		expect(exp.positions.length, 'kırılımda giriş yok').toBe(1);
		expect(exp.positions[0].entryPrice).toBe(111);
		expect(exp.positions[0].side).toBe('long');
	});
});
