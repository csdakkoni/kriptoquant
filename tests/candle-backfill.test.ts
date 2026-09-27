// ============================================================================
// REST MUM YEDEĞİ
// ============================================================================
// WebSocket bağlı görünüp veri göndermediğinde kapanan mumların REST'ten
// çekildiğini ve aynı mumun iki kez işlenmediğini doğrular. Ağa gidilmez.
// ============================================================================

import { describe, it, expect, afterEach, vi } from 'vitest';
import { AssumptionKiller } from '../src/organism/assumption-killer.js';

const PERIOD = 900_000;

function kline(ts: number, close: number) {
	return [ts, String(close), String(close), String(close), String(close), '10'];
}

describe('REST mum yedeği', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('WebSocket sessizse kapanan mumları REST ile işlemeli, tekrarları atlamalı', async () => {
		const now = Date.now();
		const lastClosed = Math.floor(now / PERIOD) * PERIOD - PERIOD;
		// Mumun kapanışından en az 30 sn geçmiş gibi davranmak için saati ileri al
		vi.spyOn(Date, 'now').mockReturnValue(lastClosed + PERIOD + 60_000);

		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => [kline(lastClosed - PERIOD, 100), kline(lastClosed, 101), kline(lastClosed + PERIOD, 102)],
		}));
		vi.stubGlobal('fetch', fetchMock);

		const killer = new AssumptionKiller() as any;
		const cycle = vi.spyOn(killer, 'runObservationCycle').mockImplementation(() => {});

		await killer.backfillMissedCandles();
		const buf = killer.candleBuffers.get('BTCUSDT');
		expect(buf.map((c: any) => c.timestamp)).toEqual([lastClosed - PERIOD, lastClosed]); // açık mum alınmaz
		const callsAfterFirst = cycle.mock.calls.length;
		expect(callsAfterFirst).toBeGreaterThan(0);

		// İkinci tur: artık eksik mum yok → ne istek ne tekrar işlem
		fetchMock.mockClear();
		await killer.backfillMissedCandles();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(cycle.mock.calls.length).toBe(callsAfterFirst);

		vi.restoreAllMocks();
	});
});
