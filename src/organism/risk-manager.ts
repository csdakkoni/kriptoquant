import { config } from '../core/config.js';
import { log, logError } from '../core/utils.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TradeRequest {
	coin: string;
	side: 'long' | 'short';
	amountUsd: number;
}

interface RiskState {
	date: string; // YYYY-MM-DD (UTC)
	dailyLossUsd: number;
	killSwitchActivated: boolean;
}

export class RiskManager {
	private dailyLossUsd = 0;
	private currentOpenTrades = 0;
	private killSwitchActivated = false;
	private currentDate = '';
	private dataDir?: string;
	private timer?: NodeJS.Timeout;

	constructor(customDataDir?: string) {
		this.dataDir = customDataDir;
		this.currentDate = this.getTodayUtcString();
		this.loadState();

		// Her dakika kontrol et: UTC gece yarısında günlük zarar sayacını sıfırla
		this.timer = setInterval(() => {
			const today = this.getTodayUtcString();
			if (today !== this.currentDate) {
				this.currentDate = today;
				this.dailyLossUsd = 0;
				this.killSwitchActivated = false;
				this.saveState();
				log('[RISK] 🌅 Yeni UTC günü başladı. Günlük zarar sayacı ve Kill Switch sıfırlandı.');
			}
		}, 60_000);
		if (this.timer.unref) this.timer.unref();
	}

	public destroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	private getDataDir(): string {
		return this.dataDir || process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');
	}

	private getRiskFilePath(): string {
		return join(this.getDataDir(), 'risk-state.json');
	}

	private getTodayUtcString(): string {
		return new Date().toISOString().slice(0, 10);
	}

	private loadState(): void {
		try {
			const riskFile = this.getRiskFilePath();
			if (existsSync(riskFile)) {
				const data = JSON.parse(readFileSync(riskFile, 'utf-8')) as RiskState;
				if (data.date === this.currentDate) {
					this.dailyLossUsd = data.dailyLossUsd || 0;
					this.killSwitchActivated = !!data.killSwitchActivated;
					log(`[RISK] 📂 Kalıcı risk durumu yüklendi: Bugün gerçekleşen zarar: $${this.dailyLossUsd.toFixed(2)}, Kill Switch: ${this.killSwitchActivated ? 'AKTİF 🚨' : 'KAPALI'}`);
					return;
				}
			}
		} catch (e) {
			logError(`[RISK] Risk durumu okunamadı: ${e}`);
		}
		this.saveState();
	}

	private saveState(): void {
		try {
			const dir = this.getDataDir();
			const riskFile = this.getRiskFilePath();
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const state: RiskState = {
				date: this.currentDate,
				dailyLossUsd: this.dailyLossUsd,
				killSwitchActivated: this.killSwitchActivated,
			};
			writeFileSync(riskFile, JSON.stringify(state, null, 2));
		} catch (e) {
			logError(`[RISK] Risk durumu kaydedilemedi: ${e}`);
		}
	}

	public onTradeOpened(): void {
		this.currentOpenTrades++;
	}

	public onTradeClosed(pnlUsd: number): void {
		this.currentOpenTrades = Math.max(0, this.currentOpenTrades - 1);

		if (pnlUsd < 0) {
			this.dailyLossUsd += Math.abs(pnlUsd);
			if (this.dailyLossUsd >= config.risk.maxDailyLossUsd && !this.killSwitchActivated) {
				this.killSwitchActivated = true;
				logError(`[RISK] 🚨 KILL SWITCH DEVREYE GİRDİ! Günlük zarar limiti ($${config.risk.maxDailyLossUsd}) aşıldı ($${this.dailyLossUsd.toFixed(2)}). Tüm yeni işlemler kilitlendi.`);
			}
			this.saveState();
		}
	}

	public syncOpenTradesCount(count: number): void {
		this.currentOpenTrades = count;
	}

	public getDailyLoss(): number {
		return this.dailyLossUsd;
	}

	public isKillSwitchActive(): boolean {
		return this.killSwitchActivated;
	}

	public validateTrade(request: TradeRequest, freeMarginUsd?: number): boolean {
		if (this.killSwitchActivated) {
			logError(`[RISK] ❌ Reddedildi (${request.coin} ${request.side.toUpperCase()}): Kill switch devrede.`);
			return false;
		}

		if (this.currentOpenTrades >= config.risk.maxOpenTrades) {
			log(`[RISK] ⏸️  Reddedildi (${request.coin} ${request.side.toUpperCase()}): Maksimum açık işlem (${config.risk.maxOpenTrades}) kotası dolu.`);
			return false;
		}

		if (request.amountUsd > config.risk.maxTradeSizeUsd) {
			logError(`[RISK] ❌ Reddedildi (${request.coin} ${request.side.toUpperCase()}): $${request.amountUsd} büyüklüğü izin verilen maksimum $${config.risk.maxTradeSizeUsd}'ı aşıyor.`);
			return false;
		}

		if (freeMarginUsd !== undefined && freeMarginUsd < request.amountUsd) {
			logError(`[RISK] ❌ Reddedildi (${request.coin} ${request.side.toUpperCase()}): Yetersiz serbest bakiye (Gereken: $${request.amountUsd}, Mevcut: $${freeMarginUsd.toFixed(2)}).`);
			return false;
		}

		return true;
	}
}
