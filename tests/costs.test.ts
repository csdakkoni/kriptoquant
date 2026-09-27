// ============================================================================
// GERÇEKÇİ MALİYET TESTLERİ
// ============================================================================
// Paper PnL'den komisyon, kayma ve funding ücretinin doğru düşüldüğünü doğrular.
// Ağa istek atılmaz; funding kayıtları elle verilir.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paperRoundTripCostPct, roundTripCostPct } from '../src/organism/costs.js';
import { FundingTracker, DEFAULT_FUNDING_PCT_PER_8H } from '../src/organism/funding.js';

const H = 60 * 60 * 1000;
// 8 saatlik funding anına hizalı bir başlangıç (00:00 UTC)
const T0 = Math.floor(Date.now() / (24 * H)) * 24 * H - 3 * 24 * H;

function tracker(): FundingTracker {
	return new FundingTracker(mkdtempSync(join(tmpdir(), 'kq-funding-')));
}

describe('Komisyon + kayma', () => {
	it('paper işlemde gidiş-dönüş maliyeti %0.20 olmalı (2 × (%0.05 + %0.05))', () => {
		expect(paperRoundTripCostPct()).toBeCloseTo(0.2, 10);
	});

	it('canlı işlemde gerçek komisyon kullanılmalı, kayma tekrar düşülmemeli', () => {
		expect(roundTripCostPct({ isLive: true, entryFeeRate: 0.045 })).toBeCloseTo(0.09, 10);
		expect(roundTripCostPct({ isLive: false })).toBeCloseTo(0.2, 10);
	});
});

describe('Funding ücreti', () => {
	const records = [0, 8, 16, 24, 32].map((h) => ({ time: T0 + h * H, rate: 0.0003 })); // %0.03

	it('pozitif oranda LONG öder', () => {
		const ft = tracker();
		ft.record('BTCUSDT', records);
		// T0+1s → T0+17s: 8h ve 16h anları dahil → 2 × %0.03
		expect(ft.fundingCostPct('BTCUSDT', 'long', T0 + 1000, T0 + 17 * H)).toBeCloseTo(0.06, 10);
	});

	it('pozitif oranda SHORT alır (maliyet negatif = kazanç)', () => {
		const ft = tracker();
		ft.record('BTCUSDT', records);
		expect(ft.fundingCostPct('BTCUSDT', 'short', T0 + 1000, T0 + 17 * H)).toBeCloseTo(-0.06, 10);
	});

	it('funding anından önce kapanan pozisyon ücret ödememeli', () => {
		const ft = tracker();
		ft.record('BTCUSDT', records);
		expect(ft.fundingCostPct('BTCUSDT', 'long', T0 + 1000, T0 + 7 * H)).toBe(0);
	});

	it('veri yoksa her 8 saat için varsayılan maliyet uygulanmalı (yön fark etmeksizin)', () => {
		const ft = tracker();
		const cost = ft.fundingCostPct('XYZUSDT', 'short', T0 + 1000, T0 + 17 * H);
		expect(cost).toBeCloseTo(2 * DEFAULT_FUNDING_PCT_PER_8H, 10);
	});

	it('aynı kayıt iki kez eklenirse iki kez sayılmamalı', () => {
		const ft = tracker();
		ft.record('BTCUSDT', records);
		ft.record('BTCUSDT', records);
		expect(ft.fundingCostPct('BTCUSDT', 'long', T0 + 1000, T0 + 17 * H)).toBeCloseTo(0.06, 10);
	});
});
