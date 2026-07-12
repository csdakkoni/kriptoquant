import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionEngine } from '../src/live/live-engine.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Mock the ws library so it does not establish internet connections
vi.mock('ws', () => {
	return {
		WebSocket: vi.fn().mockImplementation(() => {
			return {
				on: vi.fn(),
				close: vi.fn(),
				send: vi.fn(),
			};
		}),
	};
});

describe('Live Execution Altyapısı', () => {
	// Mock fetch response for Binance API bootstrapping
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => [
					[1720000000000, '100.0', '105.0', '95.0', '102.0', '1000.0', 1720000059999],
					[1720000060000, '102.0', '108.0', '101.0', '106.0', '1200.0', 1720000119999],
				],
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		const filesToDelete = [
			join(process.cwd(), 'results', 'live_paper_state.json'),
			join(process.cwd(), 'results', 'live_paper_state_ema-cross_1m.json'),
		];
		for (const path of filesToDelete) {
			if (existsSync(path)) {
				try {
					unlinkSync(path);
				} catch {}
			}
		}
	});


	it('ExecutionEngine bootstrap sürecini tamamlamalı ve çalışmaya başlamalı', async () => {
		const engine = new ExecutionEngine(['BTCUSDT'], '1m', 'ema-cross');
		expect(engine.getState().engineStatus).toBe('stopped');

		await engine.start(true);

		expect(engine.getState().engineStatus).toBe('running');
		expect(engine.getState().uptime).toBe(0);
		expect(engine.getState().cash).toBe(10000);

		engine.stop();
		expect(engine.getState().engineStatus).toBe('stopped');
	});

	it('ExecutionEngine kline tick aldığında PnL, MAE ve MFE değerlerini güncellemeli', async () => {
		const engine = new ExecutionEngine(['BTCUSDT'], '1m', 'ema-cross');
		await engine.start(true);

		// Manually inject an active position into engine state
		engine.getState().activePositions.push({
			coin: 'BTCUSDT',
			direction: 'LONG',
			entryTime: new Date().toISOString(),
			entryPrice: 100,
			currentPrice: 100,
			quantity: 10,
			positionSizeUsdt: 1000,
			stopLoss: 95,
			takeProfit: 110,
			riskPercent: 5,
			currentPnLPercent: 0,
			currentPnLUsdt: 0,
			mae: 0,
			mfe: 0,
			strategyName: 'ema-cross',
		});

		// Simulate price tick going UP to 105
		// We call the private method using bracket notation to bypass TypeScript compiler checks
		(engine as any).handleKlineTick('BTCUSDT', {
			t: 1720000200000,
			T: 1720000259999,
			s: 'BTCUSDT',
			i: '1m',
			o: '100',
			c: '105',
			h: '106',
			l: '99',
			v: '100',
			x: false, // open tick
		});

		const pos = engine.getState().activePositions[0];
		expect(pos.currentPrice).toBe(105);
		expect(pos.currentPnLPercent).toBe(5); // +5% PnL
		expect(pos.currentPnLUsdt).toBe(50); // (105 - 100) * 10 = 50 USDT
		expect(pos.mfe).toBe(5); // Peak runup: 5%
		expect(pos.mae).toBe(0);

		// Simulate price tick going DOWN to 97
		(engine as any).handleKlineTick('BTCUSDT', {
			t: 1720000260000,
			T: 1720000319999,
			s: 'BTCUSDT',
			i: '1m',
			o: '105',
			c: '97',
			h: '105',
			l: '96',
			v: '100',
			x: false,
		});

		expect(pos.currentPrice).toBe(97);
		expect(pos.currentPnLPercent).toBe(-3); // -3% PnL
		expect(pos.mae).toBe(3); // Peak drawdown: 3%
		expect(pos.mfe).toBe(5); // Keep peak runup at 5%

		engine.stop();
	});
});
