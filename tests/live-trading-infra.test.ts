import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RiskManager } from '../src/organism/risk-manager.js';
import { LiveBroker } from '../src/organism/live-broker.js';
import { calculateBracketPrices, type Experiment, type PaperPosition } from '../src/organism/experiment-runner.js';
import { reconcilePositions } from '../src/organism/reconciliation.js';
import { config } from '../src/core/config.js';

const TEST_DATA_DIR = join(process.cwd(), 'organism-data-test-infra');

describe('Live Trading Altyapı Testleri', () => {
	const originalEnvDir = process.env.ORGANISM_DATA_DIR;

	beforeEach(() => {
		process.env.ORGANISM_DATA_DIR = TEST_DATA_DIR;
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
	});

	afterEach(() => {
		process.env.ORGANISM_DATA_DIR = originalEnvDir;
		if (existsSync(TEST_DATA_DIR)) {
			rmSync(TEST_DATA_DIR, { recursive: true, force: true });
		}
	});

	describe('RiskManager Kalıcılık ve Güvenlik', () => {
		it('işlem zararlarını biriktirmeli ve kill-switch tetiklemeli', () => {
			const rm = new RiskManager();
			expect(rm.getDailyLoss()).toBe(0);
			expect(rm.isKillSwitchActive()).toBe(false);

			// Küçük zarar
			rm.onTradeClosed(-2);
			expect(rm.getDailyLoss()).toBe(2);
			expect(rm.isKillSwitchActive()).toBe(false);

			// Limiti aşan zarar (Varsayılan maxDailyLossUsd: 5)
			rm.onTradeClosed(-4);
			expect(rm.getDailyLoss()).toBe(6);
			expect(rm.isKillSwitchActive()).toBe(true);

			// Kill-switch devredeyken yeni işlem reddedilmeli
			const valid = rm.validateTrade({ coin: 'BTCUSDT', side: 'long', amountUsd: 10 });
			expect(valid).toBe(false);
		});

		it('diskten durum yükleyebilmeli (restart koruması)', () => {
			const rm1 = new RiskManager();
			rm1.onTradeClosed(-3);
			expect(rm1.getDailyLoss()).toBe(3);

			// Simüle edilen restart: yeni bir RiskManager oluşturulur
			const rm2 = new RiskManager();
			expect(rm2.getDailyLoss()).toBe(3);
			expect(rm2.isKillSwitchActive()).toBe(false);

			// Zarar devam edip limiti aşarsa
			rm2.onTradeClosed(-3);
			expect(rm2.isKillSwitchActive()).toBe(true);

			// Başka bir restart sonrasında bile kill-switch aktif kalmalı
			const rm3 = new RiskManager();
			expect(rm3.isKillSwitchActive()).toBe(true);
			expect(rm3.validateTrade({ coin: 'ETHUSDT', side: 'long', amountUsd: 10 })).toBe(false);
		});

		it('serbest teminat yetersizse işlemi reddetmeli', () => {
			const rm = new RiskManager();
			// Bakiye $5, istenen tutar $10
			const allowed = rm.validateTrade({ coin: 'BTCUSDT', side: 'long', amountUsd: 10 }, 5);
			expect(allowed).toBe(false);

			// Bakiye $20, istenen tutar $10
			const allowedWithSufficientMargin = rm.validateTrade({ coin: 'BTCUSDT', side: 'long', amountUsd: 10 }, 20);
			expect(allowedWithSufficientMargin).toBe(true);
		});

		it('maksimum açık işlem sayısını aşmamalı', () => {
			const rm = new RiskManager();
			rm.syncOpenTradesCount(config.risk.maxOpenTrades);
			const allowed = rm.validateTrade({ coin: 'BTCUSDT', side: 'long', amountUsd: 10 });
			expect(allowed).toBe(false);
		});
	});

	describe('LiveBroker Sembol ve Bracket Fiyat Hesaplama', () => {
		it('sembol dönüşümleri standart CCXT swap formatında olmalı', () => {
			const broker = new LiveBroker();
			expect(broker.toSymbol('BTCUSDT')).toBe('BTC/USDT:USDT');
			expect(broker.toSymbol('ETHUSDT')).toBe('ETH/USDT:USDT');
			expect(broker.toCoin('BTC/USDT:USDT')).toBe('BTCUSDT');
			expect(broker.toCoin('BTC/USDT')).toBe('BTCUSDT');
		});

		it('stop_and_target kuralında doğru bracket fiyatları üretmeli', () => {
			// LONG: Giriş 100, Stop %3 (97), Hedef %6 (106)
			const longBracket = calculateBracketPrices(
				{ type: 'stop_and_target', stopPercent: 3, targetPercent: 6 },
				100,
				'long',
			);
			expect(longBracket.stopPrice).toBeCloseTo(97, 4);
			expect(longBracket.targetPrice).toBeCloseTo(106, 4);

			// SHORT: Giriş 100, Stop %3 (103), Hedef %6 (94)
			const shortBracket = calculateBracketPrices(
				{ type: 'stop_and_target', stopPercent: 3, targetPercent: 6 },
				100,
				'short',
			);
			expect(shortBracket.stopPrice).toBeCloseTo(103, 4);
			expect(shortBracket.targetPrice).toBeCloseTo(94, 4);
		});

		it('stop_and_target_atr kuralında ATR çarpanlarını doğru uygulamalı', () => {
			// ATR = %2. Entry = 100. Stop 3×ATR (%6 → 94), Target 3×ATR (%6 → 106)
			const atrBracket = calculateBracketPrices(
				{ type: 'stop_and_target_atr', stopMultiplier: 3.0, targetMultiplier: 3.0 },
				100,
				'long',
				2.0,
			);
			expect(atrBracket.stopPrice).toBeCloseTo(94, 4);
			expect(atrBracket.targetPrice).toBeCloseTo(106, 4);
		});

		it('kuru sıkı (dry-run) modunda emir simülasyonu başarıyla dönmeli', async () => {
			const rm = new RiskManager();
			const broker = new LiveBroker(rm);
			expect(broker.isLive()).toBe(false);

			const res = await broker.executeEntry('SOLUSDT', 'long', 150, 145, 160);
			expect(res.success).toBe(true);
			expect(res.filledPrice).toBe(150);

			const exitRes = await broker.executeExit('SOLUSDT', 'long', 155, 1.5);
			expect(exitRes).toBe(true);
		});
	});

	describe('Reconciliation (Mutabakat)', () => {
		it('dry-run modunda mutabakat hatasız tamamlanmalı', async () => {
			const broker = new LiveBroker();
			const mockExperiments: Experiment[] = [];
			await expect(reconcilePositions(mockExperiments, broker)).resolves.not.toThrow();
		});

		it('canlı modda borsada kapanan pozisyonu experiments.json ile eşitlemeli', async () => {
			const rm = new RiskManager();
			const broker = new LiveBroker(rm);
			// Test için broker'ı geçici olarak canlı gibi mock'layalım
			(broker as any).liveEnabled = true;
			(broker as any).fetchOpenPositions = async () => []; // Borsada pozisyon kalmamış (tetiklenmiş kapanmış)

			const exp: Experiment = {
				id: 'exp-live-1',
				name: 'Live Test Exp',
				hypothesis: 'Test',
				entryRule: { type: 'always_long' },
				exitRule: { type: 'stop_loss', percent: 2 },
				isLiveTradingEnabled: true,
				coins: ['BTCUSDT'],
				status: 'running',
				startedAt: Date.now(),
				maxDurationHours: 24,
				positions: [
					{
						id: 'pos-1',
						experimentId: 'exp-live-1',
						coin: 'BTCUSDT',
						side: 'long',
						entryPrice: 50000,
						entryTime: Date.now() - 3600000,
						candlesSinceEntry: 4,
						highSinceEntry: 50000,
						lowSinceEntry: 49000,
						isLive: true,
					},
				],
				closedPositions: [],
				stats: {
					totalTrades: 0,
					wins: 0,
					losses: 0,
					totalPnlPercent: 0,
					avgPnlPercent: 0,
					winRate: 0,
					avgWinPercent: 0,
					avgLossPercent: 0,
					maxDrawdownPercent: 0,
				},
			};

			await reconcilePositions([exp], broker);

			// Pos-1 exp.positions'dan çıkıp closedPositions'a taşınmış olmalı
			expect(exp.positions.length).toBe(0);
			expect(exp.closedPositions.length).toBe(1);
			expect(exp.closedPositions[0].exitReason).toBe('exchange_bracket_trigger');
		});
	});
});
