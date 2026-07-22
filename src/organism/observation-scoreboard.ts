// ============================================================================
// ORGANISM — Observation Scoreboard (Gözlem Karnesi)
// ============================================================================
// Gözlem akışını süs olmaktan çıkaran modül: her gözlemin ("divergence",
// "silence", "herd", "surprise"...) ardından fiyatın 1s/4s/24s sonra ne
// yaptığını otomatik ölçer. Böylece hangi gözlemcinin gözü keskin, hangisi
// gürültü üretiyor — veriyle sıralanır. Güçlü çıkan tip, yeni deneylerin
// giriş sinyali adayıdır (ters çalışan tip de tersine sinyal adayı!).
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Observation, MarketTick } from './types.js';

const STATE_DIR = join(process.cwd(), 'organism-data');
const SCOREBOARD_FILE = join(STATE_DIR, 'observation-scoreboard.json');

const CANDLE_MS = 900_000; // 15m
// Ölçüm ufukları (mum cinsinden): 4 = 1 saat, 16 = 4 saat, 48 = 12 saat, 96 = 24 saat, 192 = 48 saat
export const HORIZONS = [4, 16, 48, 96, 192] as const;

const COOLDOWN_CANDLES = 4; // Aynı tip+coin için 1 saat içinde tekrar kayıt alma
const MAX_PENDING = 500;

interface PendingEntry {
	type: string;
	coin: string;
	ts: number; // gözlem anındaki mumun openTime'ı
	price: number; // gözlem anındaki kapanış
	doneHorizons: number[];
}

interface ScoreCell {
	n: number;
	sumRet: number; // yüzde cinsinden toplam forward getiri
	pos: number; // pozitif sonuçlanan sayısı
}

interface ScoreboardState {
	pending: PendingEntry[];
	// scores[type][horizon] = ScoreCell
	scores: Record<string, Record<string, ScoreCell>>;
}

export class ObservationScoreboard {
	private state: ScoreboardState = { pending: [], scores: {} };
	private dirty = false;

	constructor() {
		this.load();
	}

	/** Yeni gözlemleri ölçüm kuyruğuna al. */
	record(observations: Observation[], ticks: Map<string, MarketTick[]>): void {
		for (const obs of observations) {
			for (const coin of (obs.coins || []).slice(0, 5)) {
				const candles = ticks.get(coin);
				if (!candles || candles.length === 0) continue;
				const latest = candles[candles.length - 1];

				// Cooldown: aynı tip+coin için kısa aralıkla mükerrer kayıt alma
				// (herd gibi gözlemler koşul sürdükçe her mumda tekrar tetiklenir)
				const recent = this.state.pending.some(
					(p) => p.type === obs.type && p.coin === coin && latest.timestamp - p.ts < COOLDOWN_CANDLES * CANDLE_MS,
				);
				if (recent) continue;
				if (this.state.pending.length >= MAX_PENDING) break;

				this.state.pending.push({
					type: obs.type,
					coin,
					ts: latest.timestamp,
					price: latest.close,
					doneHorizons: [],
				});
				this.dirty = true;
			}
		}
	}

	/** Olgunlaşan ufukları ölç ve karneye işle. Idempotent — sık çağrılabilir. */
	update(ticks: Map<string, MarketTick[]>): void {
		const stillPending: PendingEntry[] = [];

		for (const p of this.state.pending) {
			const candles = ticks.get(p.coin);
			if (!candles || candles.length === 0) {
				stillPending.push(p);
				continue;
			}
			const latest = candles[candles.length - 1];

			for (const h of HORIZONS) {
				if (p.doneHorizons.includes(h)) continue;
				const targetTs = p.ts + h * CANDLE_MS;
				if (latest.timestamp < targetTs) continue;

				// Hedef zamana en yakın (>= target) mumu bul
				const target = candles.find((c) => c.timestamp >= targetTs);
				if (!target) continue; // buffer'dan düşmüş — ölçemeyiz, sonraki update'te de bulunamaz ama zararsız

				const retPct = ((target.close - p.price) / p.price) * 100;
				const typeScores = (this.state.scores[p.type] ??= {});
				const cell = (typeScores[String(h)] ??= { n: 0, sumRet: 0, pos: 0 });
				cell.n++;
				cell.sumRet += retPct;
				if (retPct > 0) cell.pos++;
				p.doneHorizons.push(h);
				this.dirty = true;
			}

			// Tüm ufuklar ölçüldüyse veya kayıt 50 saatten eskiyse kuyruğdan düş
			const expired = latest.timestamp - p.ts > 200 * CANDLE_MS;
			if (p.doneHorizons.length < HORIZONS.length && !expired) {
				stillPending.push(p);
			}
		}

		this.state.pending = stillPending;
		if (this.dirty) {
			this.save();
			this.dirty = false;
		}
	}

	getState(): ScoreboardState {
		return this.state;
	}

	private load(): void {
		if (existsSync(SCOREBOARD_FILE)) {
			try {
				this.state = JSON.parse(readFileSync(SCOREBOARD_FILE, 'utf-8'));
				return;
			} catch {}
		}
	}

	private save(): void {
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(SCOREBOARD_FILE, JSON.stringify(this.state, null, 2));
	}
}
