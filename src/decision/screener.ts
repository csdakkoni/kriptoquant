// ============================================================================
// KRIPTOQUANT — Screener Engine (Sprint 31)
// ============================================================================

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DecisionEngine } from './decision-engine.js';
import { MarketRegimeEngine } from './regime-engine.js';
import { StressTestingEngine, type StressScenarioResult } from './stress-testing.js';
import { MonteCarloSimulator } from './monte-carlo.js';
import { MetaModelEngine } from '../research/meta-model.js';
import { ProbabilityCalibrator } from '../research/calibration.js';
import type { Candle } from '../core/types.js';
import { log, logError } from '../core/utils.js';
import { atr } from '../core/indicators/index.js';

export interface ScreenerItem {
	coin: string;
	score: number; // Opportunity score (0-100)
	signal: 'BUY' | 'SELL' | 'WAIT';
	confidence: number;
	risk: 'LOW' | 'MEDIUM' | 'HIGH';
	marketRegime: string; // Coin level regime
	recommendedAllocation: number; // Recommended budget % (e.g. 12%)
	lastPrice: number;
	rsiVal: number;
	adxVal: number;
	atrPercentile: number;
	emaSlope: string;
	metaModelProb: number; // P(Profit) from ML meta-model
	reasons?: any[];
	entryPrice?: number;
	stopLossPrice?: number;
	takeProfitPrice?: number;
	expectedR?: number;
}

export interface ScreenerState {
	lastUpdated: string;
	globalRegime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'CHOPPY';
	cvar95: number;
	ruinProbability: number;
	expectedMaxDrawdown: number;
	stressScenarios: StressScenarioResult[];
	items: ScreenerItem[];
}

export class ScreenerEngine {
	private decisionEngine: DecisionEngine;
	private regimeEngine: MarketRegimeEngine;
	private stressTesting: StressTestingEngine;
	private monteCarlo: MonteCarloSimulator;
	private metaModel: MetaModelEngine;
	private calibrator: ProbabilityCalibrator;

	private coins = [
		'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT',
		'XRPUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT',
		'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'LTCUSDT', 'POLUSDT'
	];
	private statePath: string;

	constructor() {
		this.decisionEngine = new DecisionEngine();
		this.regimeEngine = new MarketRegimeEngine();
		this.stressTesting = new StressTestingEngine();
		this.monteCarlo = new MonteCarloSimulator();
		this.metaModel = new MetaModelEngine();
		this.calibrator = new ProbabilityCalibrator();
		this.statePath = join(process.cwd(), 'results', 'screener_state.json');
	}

	public async scanAll(): Promise<ScreenerState> {
		log(`ScreenerEngine is scanning ${this.coins.length} coins...`);
		const items: ScreenerItem[] = [];

		let btcBull = true;
		let ethBull = true;

		for (const coin of this.coins) {
			try {
				const candles = await this.fetchHistory(coin);
				if (candles.length < 50) continue;

				const lastCandle = candles[candles.length - 1];
				const prevCandle = candles[candles.length - 2];
				
				// 1) Evaluate Regime using MarketRegimeEngine
				const regimeDetails = this.regimeEngine.detectRegime(candles);

				if (coin === 'BTCUSDT' && regimeDetails.regime === 'TRENDING_BEAR') btcBull = false;
				if (coin === 'ETHUSDT' && regimeDetails.regime === 'TRENDING_BEAR') ethBull = false;

				// 2) Evaluate Consensus
				const dec = this.decisionEngine.evaluateConsensus(coin, candles);

				// Risk
				let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
				if (dec.confidence > 70) risk = 'LOW';
				else if (dec.confidence < 40) risk = 'HIGH';

				// Recommended Allocation (cap to 15%)
				let recAllocation = 0;
				if (dec.signal === 'BUY') {
					recAllocation = Math.round((dec.confidence / 100) * 15);
				}

				// Opportunity Score formula
				let opportunityScore = dec.confidence;
				if (regimeDetails.regime === 'TRENDING_BULL') opportunityScore += 15;
				if (regimeDetails.regime === 'BREAKOUT') opportunityScore += 10;
				
				if (opportunityScore > 100) opportunityScore = 100;
				if (opportunityScore < 0) opportunityScore = 0;

				// Mock RSI
				const mockRsi = Math.round(50 + (Math.random() * 20 - 10));

				// 3) Predict Winning Probability using MetaModelEngine
				const emaSlopeVal = (lastCandle.close - prevCandle.close) / (prevCandle.close || 1);
				const volumes = candles.map(c => c.volume);
				const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
				const volumeSpike = lastCandle.volume > (avgVolume * 1.5) ? 1 : 0;

				const metaPrediction = this.metaModel.predictProfitProbability({
					emaSlope: emaSlopeVal,
					adxVal: regimeDetails.adxVal,
					atrPercentile: regimeDetails.atrPercentile,
					rsiVal: mockRsi,
					volumeSpike
				});

				const calibratedProb = this.calibrator.calibrate(metaPrediction.probabilityOfProfit);

				// Calculate ATR dynamically for Stop Loss
				const atrValues = atr(candles, 14);
				const currentAtr = atrValues[atrValues.length - 1] || (lastCandle.close * 0.02); // fallback to 2%
				const atrMultiplier = 2.0; 
				const riskAmount = currentAtr * atrMultiplier;

				const entryPrice = lastCandle.close;
				const stopLossPrice = entryPrice - riskAmount;
				
				// Target price using R-multiple (R = 2.5)
				const expectedR = 2.5;
				const takeProfitPrice = entryPrice + riskAmount * expectedR;

				items.push({
					coin,
					score: opportunityScore,
					signal: dec.signal,
					confidence: dec.confidence,
					risk,
					marketRegime: regimeDetails.regime,
					recommendedAllocation: recAllocation,
					lastPrice: lastCandle.close,
					rsiVal: mockRsi,
					adxVal: regimeDetails.adxVal,
					atrPercentile: regimeDetails.atrPercentile,
					emaSlope: regimeDetails.emaSlope,
					metaModelProb: Math.round(calibratedProb * 100),
					reasons: dec.reasons,
					entryPrice,
					stopLossPrice,
					takeProfitPrice,
					expectedR
				});

			} catch (e) {
				logError(`Screener failed to scan ${coin}: ${e}`);
			}
		}

		// Sort by Opportunity Score descending
		items.sort((a, b) => b.score - a.score);

		// Overall Global Regime
		let globalRegime: 'BULLISH_TREND' | 'BEARISH_TREND' | 'CHOPPY' = 'CHOPPY';
		if (btcBull && ethBull) globalRegime = 'BULLISH_TREND';
		else if (!btcBull && !ethBull) globalRegime = 'BEARISH_TREND';

		// 4) Calculate expected portfolio-level risk statistics (CVaR & Monte Carlo)
		const mockReturns = [
			-0.015, 0.021, -0.008, 0.035, -0.012, 0.045, -0.022, 0.011, -0.004, 0.018,
			-0.031, 0.025, -0.014, 0.009, -0.002, 0.015, -0.025, 0.032, -0.018, 0.005,
			-0.011, 0.022, -0.007, 0.014, -0.009, 0.028, -0.016, 0.012, -0.005, 0.021
		];

		const cvar95 = this.stressTesting.calculateCVaR95(mockReturns);
		
		const mc = this.monteCarlo.simulateRisk(10000, 0.45, 2.2, 1.0, 50);
		
		const totalAllocation = items.reduce((acc, i) => acc + i.recommendedAllocation, 0);
		const stressScenarios = this.stressTesting.runMacroStressTests(10000, totalAllocation);

		const state: ScreenerState = {
			lastUpdated: new Date().toISOString(),
			globalRegime,
			cvar95,
			ruinProbability: mc.ruinProbability,
			expectedMaxDrawdown: mc.expectedMaxDrawdown,
			stressScenarios,
			items
		};

		// Save state
		try {
			const dir = join(process.cwd(), 'results');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(this.statePath, JSON.stringify(state, null, 4));
		} catch (e) {
			logError(`Failed to save screener state: ${e}`);
		}

		return state;
	}

	private async fetchHistory(symbol: string, limit: number = 100): Promise<Candle[]> {
		const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP error ${res.status}`);
		const data = await res.json() as any[];
		return data.map((d: any) => ({
			openTime: Number(d[0]),
			open: parseFloat(d[1]),
			high: parseFloat(d[2]),
			low: parseFloat(d[3]),
			close: parseFloat(d[4]),
			volume: parseFloat(d[5]),
			closeTime: Number(d[6]),
		}));
	}
}
