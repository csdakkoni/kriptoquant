// ============================================================================
// CANLI EMİR GÜVENLİK TESTLERİ
// ============================================================================
// LiveBroker ve mutabakatı SAHTE bir borsa nesnesiyle çalıştırır. Gerçek
// Binance'e hiçbir istek gitmez. Her test, gerçek parada zarar doğuracak bir
// hata senaryosunu doğrular.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RiskManager } from '../src/organism/risk-manager.js';
import { LiveBroker } from '../src/organism/live-broker.js';
import { ExperimentRunner, type Experiment } from '../src/organism/experiment-runner.js';
import { KnowledgeGraph } from '../src/organism/knowledge-graph.js';
import { reconcilePositions } from '../src/organism/reconciliation.js';
import type { MarketTick } from '../src/organism/types.js';

const TEST_DATA_DIR = join(process.cwd(), 'organism-data-test-safety');

interface Call { method: string; args: any[] }

/** Binance'i taklit eden sahte ccxt borsası; tüm çağrıları kaydeder */
function makeFakeExchange(over: Partial<Record<string, (...a: any[]) => any>> = {}) {
	const calls: Call[] = [];
	const rec = (method: string, impl: (...a: any[]) => any) => async (...args: any[]) => {
		calls.push({ method, args });
		return impl(...args);
	};
	const defaults: Record<string, (...a: any[]) => any> = {
		loadMarkets: () => ({}),
		setMarginMode: () => ({}),
		setLeverage: () => ({}),
		fetchBalance: () => ({ free: { USDT: 100 } }),
		fetchPositions: () => [],
		cancelAllOrders: () => ({}),
		cancelOrder: () => ({}),
		createMarketOrder: () => ({ id: 'entry-1', average: 100, filled: 0.06 }),
		createOrder: (_s: string, type: string) => ({ id: `${type}-1` }),
		fetchMyTrades: () => [],
		fetchOrder: () => ({}),
	};
	const ex: any = {};
	for (const [k, v] of Object.entries({ ...defaults, ...over })) ex[k] = rec(k, v!);
	ex.market = () => ({ limits: { cost: { min: 5 } } });
	ex.amountToPrecision = (_s: string, a: number) => a.toFixed(3);
	ex.priceToPrecision = (_s: string, p: number) => p.toFixed(2);
	return { ex, calls };
}

function liveBroker(ex: any): LiveBroker {
	const broker = new LiveBroker(new RiskManager());
	(broker as any).liveEnabled = true;
	(broker as any).exchange = ex;
	return broker;
}

const names = (calls: Call[]) => calls.map(c => c.method);

describe('Canlı emir güvenliği', () => {
	beforeEach(() => {
		process.env.ORGANISM_DATA_DIR = TEST_DATA_DIR;
		if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
	});
	afterEach(() => {
		if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true, force: true });
	});

	it('stop emri konulamazsa pozisyonu hemen kapatmalı ve başarısız dönmeli', async () => {
		const { ex, calls } = makeFakeExchange({
			createOrder: () => { throw new Error('-4120 Order type not supported'); },
		});
		const res = await liveBroker(ex).executeEntry('SOLUSDT', 'long', 100, 97, 106);

		expect(res.success).toBe(false);
		const market = calls.filter(c => c.method === 'createMarketOrder');
		expect(market).toHaveLength(2);
		expect(market[1].args[1]).toBe('sell');
		expect(market[1].args[4]).toMatchObject({ reduceOnly: true });
	});

	it('kaldıraç ayarlanamazsa emir göndermemeli', async () => {
		const { ex, calls } = makeFakeExchange({
			setLeverage: () => { throw new Error('network'); },
		});
		const res = await liveBroker(ex).executeEntry('SOLUSDT', 'long', 100, 97, 106);

		expect(res.success).toBe(false);
		expect(names(calls)).not.toContain('createMarketOrder');
	});

	it('borsada aynı sembolde pozisyon varsa ikinci girişi reddetmeli', async () => {
		const { ex, calls } = makeFakeExchange({
			fetchPositions: () => [{ symbol: 'SOL/USDT:USDT', contracts: 0.06, side: 'long' }],
		});
		const res = await liveBroker(ex).executeEntry('SOLUSDT', 'short', 100, 103, 94);

		expect(res.success).toBe(false);
		expect(names(calls)).not.toContain('createMarketOrder');
	});

	it('stopsuz kurala bile borsada felaket stopu koymalı', async () => {
		const { ex, calls } = makeFakeExchange();
		const res = await liveBroker(ex).executeEntry('SOLUSDT', 'long', 100);

		expect(res.success).toBe(true);
		const stop = calls.find(c => c.method === 'createOrder' && c.args[1] === 'STOP_MARKET');
		expect(stop).toBeDefined();
		expect(stop!.args[5].stopPrice).toBeLessThan(100);
	});

	it('girişten önce bayat koşullu (algo) emirleri de iptal etmeli', async () => {
		const { ex, calls } = makeFakeExchange();
		await liveBroker(ex).executeEntry('SOLUSDT', 'long', 100, 97, 106);

		const cancels = calls.filter(c => c.method === 'cancelAllOrders');
		expect(cancels.some(c => c.args[1]?.trigger === true)).toBe(true);
	});

	it('çıkışta stop/TP iptalini algo servisine (trigger) göndermeli', async () => {
		const { ex, calls } = makeFakeExchange();
		await liveBroker(ex).executeExit('SOLUSDT', 'long', 105, 0.3, 'stop-9', 'tp-9');

		const cancels = calls.filter(c => c.method === 'cancelOrder');
		expect(cancels).toHaveLength(2);
		for (const c of cancels) expect(c.args[2]).toMatchObject({ trigger: true });
	});

	it('pozisyon sorgusu başarısızsa mutabakat hiçbir pozisyonu kapatmamalı', async () => {
		const { ex } = makeFakeExchange({
			fetchPositions: () => { throw new Error('timeout'); },
		});
		const broker = liveBroker(ex);
		const exp = {
			id: 'e1', name: 'E1', hypothesis: '', entryRule: { type: 'always_long' },
			exitRule: { type: 'stop_loss', percent: 2 }, coins: ['BTCUSDT'], status: 'running',
			startedAt: Date.now(), maxDurationHours: 24, closedPositions: [],
			positions: [{
				id: 'p1', experimentId: 'e1', coin: 'BTCUSDT', side: 'long', entryPrice: 50000,
				entryTime: Date.now(), candlesSinceEntry: 1, highSinceEntry: 50000, lowSinceEntry: 50000, isLive: true,
			}],
			stats: {} as any,
		} as Experiment;

		await reconcilePositions([exp], broker);

		expect(exp.positions).toHaveLength(1);
		expect(exp.closedPositions).toHaveLength(0);
	});

	it('öksüz SHORT pozisyonu alış (buy) emriyle kapatmalı', async () => {
		let open = true;
		const { ex, calls } = makeFakeExchange({
			fetchPositions: () => (open ? [{ symbol: 'ETH/USDT:USDT', contracts: 0.01, side: 'short' }] : []),
			createMarketOrder: () => { open = false; return { id: 'x', average: 3000 }; },
		});

		await reconcilePositions([], liveBroker(ex));

		const close = calls.find(c => c.method === 'createMarketOrder');
		expect(close).toBeDefined();
		expect(close!.args[1]).toBe('buy');
		expect(close!.args[4]).toMatchObject({ reduceOnly: true });
	});

	it('iki deney aynı coine girerse yalnızca ilki borsaya gitmeli', () => {
		const runner = new ExperimentRunner(new KnowledgeGraph());
		runner.setRegimeProvider(() => 'BULL');
		const entries: string[] = [];
		const broker = runner.getLiveBroker();
		(broker as any).liveEnabled = true;
		(broker as any).executeEntry = (coin: string) => {
			entries.push(coin);
			return new Promise(() => {}); // yanıt bekleniyor (livePending)
		};

		const mk = (id: string): Experiment => ({
			id, name: id, hypothesis: '', entryRule: { type: 'always_long' },
			exitRule: { type: 'fixed_candles', n: 10 }, coins: ['BTCUSDT'], status: 'running',
			startedAt: Date.now(), maxDurationHours: 24, positions: [], closedPositions: [],
			isLiveTradingEnabled: true, stats: {} as any,
		});
		const list = runner.getExperiments();
		list.length = 0;
		list.push(mk('A'), mk('B'));

		const ticks: MarketTick[] = [0, 1].map(i => ({
			coin: 'BTCUSDT', timestamp: 1_700_000_000_000 + i * 900_000,
			open: 100, high: 100, low: 100, close: 100, volume: 1, interval: '15m',
		}));
		runner.processTick(new Map([['BTCUSDT', ticks]]), []);

		expect(list[0].positions).toHaveLength(1);
		expect(list[1].positions).toHaveLength(1); // paper olarak açılır
		expect(entries).toEqual(['BTCUSDT']); // borsaya yalnızca bir kez
	});
});
