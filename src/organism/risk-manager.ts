import { config } from '../core/config.js';
import { log, logError } from '../core/utils.js';

export interface TradeRequest {
	coin: string;
	side: 'long' | 'short';
	amountUsd: number;
}

export class RiskManager {
	private dailyLossUsd = 0;
	private currentOpenTrades = 0;
	private killSwitchActivated = false;

	constructor() {
		// Reset daily loss at midnight UTC
		setInterval(() => {
			const now = new Date();
			if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
				this.dailyLossUsd = 0;
				this.killSwitchActivated = false;
				log('[RISK] Daily loss counters reset.');
			}
		}, 60000);
	}

	public onTradeOpened() {
		this.currentOpenTrades++;
	}

	public onTradeClosed(pnlUsd: number) {
		this.currentOpenTrades = Math.max(0, this.currentOpenTrades - 1);
		
		if (pnlUsd < 0) {
			this.dailyLossUsd += Math.abs(pnlUsd);
			if (this.dailyLossUsd >= config.risk.maxDailyLossUsd && !this.killSwitchActivated) {
				this.killSwitchActivated = true;
				logError(`[RISK] 🚨 KILL SWITCH ACTIVATED! Daily loss limit ($${config.risk.maxDailyLossUsd}) reached. All new trades blocked.`);
			}
		}
	}

	public validateTrade(request: TradeRequest): boolean {
		if (this.killSwitchActivated) {
			logError(`[RISK] Rejected ${request.side} on ${request.coin}: Kill switch is active.`);
			return false;
		}

		if (this.currentOpenTrades >= config.risk.maxOpenTrades) {
			log(`[RISK] Rejected ${request.side} on ${request.coin}: Max open trades (${config.risk.maxOpenTrades}) reached.`);
			return false;
		}

		if (request.amountUsd > config.risk.maxTradeSizeUsd) {
			logError(`[RISK] Rejected ${request.side} on ${request.coin}: Trade size $${request.amountUsd} exceeds max $${config.risk.maxTradeSizeUsd}.`);
			return false;
		}

		return true;
	}
}
