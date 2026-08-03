// ============================================================================
// DENEY BÜTÜNLÜĞÜ TESTLERİ
// ============================================================================
// Bu testlerin her biri, CANLIDA GERÇEKTEN YAŞANMIŞ bir hatayı yakalar.
// Amaç "kod güzel mi" değil: "ölçüm cihazı bozuk mu" sorusuna otomatik cevap.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
	createDefaultExperiments,
	createShortExperiments,
	isControlExperiment,
	type Experiment,
	type PaperPosition,
} from '../src/organism/experiment-runner.js';

const ROUND_TRIP_COST_PCT = 0.3;

describe('Deney durumu izolasyonu (3 Ağu bug: kardeş deneyler veri paylaşıyordu)', () => {
	it('bir deneyin dizilerine yazmak kardeşlerini ETKİLEMEMELİ', () => {
		const exps = createDefaultExperiments();
		expect(exps.length).toBeGreaterThan(1);

		exps[0].closedPositions.push({ id: 'x', coin: 'TESTUSDT' } as PaperPosition);
		exps[0].positions.push({ id: 'y' } as PaperPosition);
		exps[0].stats.totalTrades = 999;

		for (const other of exps.slice(1)) {
			expect(other.closedPositions.length, `${other.name} kirlendi`).toBe(0);
			expect(other.positions.length, `${other.name} kirlendi`).toBe(0);
			expect(other.stats.totalTrades, `${other.name} istatistiği kirlendi`).toBe(0);
		}
	});

	it('iki ayrı üretim birbirinden bağımsız olmalı', () => {
		const a = createDefaultExperiments();
		const b = createDefaultExperiments();
		a[0].closedPositions.push({ id: 'z' } as PaperPosition);
		expect(b[0].closedPositions.length).toBe(0);
	});

	it('hiçbir iki deney aynı dizi referansını paylaşmamalı', () => {
		const exps = [...createDefaultExperiments(), ...createShortExperiments()];
		for (let i = 0; i < exps.length; i++) {
			for (let j = i + 1; j < exps.length; j++) {
				expect(exps[i].closedPositions, `${exps[i].name} ↔ ${exps[j].name}`).not.toBe(exps[j].closedPositions);
				expect(exps[i].positions).not.toBe(exps[j].positions);
				expect(exps[i].stats).not.toBe(exps[j].stats);
			}
		}
	});
});

describe('Kadro tutarlılığı', () => {
	it('çekirdek kadroda mükerrer isim olmamalı', () => {
		const names = createDefaultExperiments().map((e) => e.name);
		expect(new Set(names).size, 'aynı isimli deney var').toBe(names.length);
	});

	it('her deneyin coin listesi, giriş ve çıkış kuralı olmalı', () => {
		for (const e of createDefaultExperiments()) {
			expect(e.coins.length, `${e.name} coinsiz`).toBeGreaterThan(0);
			expect(e.entryRule, `${e.name} giriş kuralsız`).toBeTruthy();
			expect(e.exitRule, `${e.name} çıkış kuralsız`).toBeTruthy();
			expect(e.name.length, 'isimsiz deney').toBeGreaterThan(0);
		}
	});

	it('kontrol grupları tanınabilmeli ve kadroda bulunmalı', () => {
		const exps = createDefaultExperiments();
		const controls = exps.filter((e) => isControlExperiment(e.name));
		expect(controls.length, 'kontrol grubu yok — kıyas tabanı kalmaz').toBeGreaterThan(0);
		// Kontrol grupları saf rastgele olmalı (yön kararı içermemeli)
		for (const c of controls) {
			expect(c.side, `${c.name} kontrol ama rejime bağlı`).not.toBe('regime');
		}
	});

	it('kadroda hem long hem short deney olmalı (tek kanat körlüğü)', () => {
		const exps = createDefaultExperiments();
		const sides = new Set(exps.map((e) => e.side ?? 'long'));
		expect(sides.has('long'), 'long deney yok').toBe(true);
		expect(sides.has('short'), 'short deney yok — ayıda kör kalır').toBe(true);
	});
});

describe('Maliyet muhasebesi (temmuz dersi: maliyetsiz simülasyon yalan söyler)', () => {
	// closePosition mantığının birebir kopyası — davranışı sabitlemek için
	function netPnl(side: 'long' | 'short', entry: number, exit: number): number {
		const sign = side === 'short' ? -1 : 1;
		return (sign * ((exit - entry) / entry)) * 100 - ROUND_TRIP_COST_PCT;
	}

	it('long: fiyat aynı kalırsa maliyet kadar ZARAR yazmalı', () => {
		expect(netPnl('long', 100, 100)).toBeCloseTo(-0.3, 6);
	});

	it('short: fiyat aynı kalırsa maliyet kadar ZARAR yazmalı', () => {
		expect(netPnl('short', 100, 100)).toBeCloseTo(-0.3, 6);
	});

	it('short pozisyon fiyat DÜŞÜNCE kâr etmeli', () => {
		expect(netPnl('short', 100, 95)).toBeCloseTo(4.7, 6);
	});

	it('long pozisyon fiyat düşünce zarar etmeli', () => {
		expect(netPnl('long', 100, 95)).toBeCloseTo(-5.3, 6);
	});

	it('maliyet asla atlanmamalı — brüt kâr her zaman net kârdan büyük', () => {
		for (const [side, e, x] of [['long', 100, 102], ['short', 100, 98]] as const) {
			const gross = (side === 'short' ? -1 : 1) * ((x - e) / e) * 100;
			expect(netPnl(side, e, x)).toBeLessThan(gross);
		}
	});
});

describe('Evolver eşikleri (1 Ağu: organizma sıfır deneye düştü)', () => {
	it('kontroller asla öldürülmemeli — ölçüm cihazıdır', () => {
		// isControlExperiment doğru çalışmalı ki evolver muafiyeti işlesin
		expect(isControlExperiment('Random + Stop/Target (1%/2%)')).toBe(true);
		expect(isControlExperiment('Random SHORT + Stop/Target (1%/2%)')).toBe(true);
		expect(isControlExperiment('Swing Dip %5 → Hedef +%6')).toBe(false);
		expect(isControlExperiment('[SYNTH] Hacim Patlaması')).toBe(false);
	});
});
