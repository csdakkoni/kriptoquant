// ============================================================================
// KRIPTOQUANT — Dashboard Local HTTP Server & Event Bus (Sprint 28)
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';
import {
	startExecutionEngine,
	stopExecutionEngine,
	getExecutionEngineState,
	getAllExecutionEnginesSummary,
	EngineState,
} from '../live/live-engine.js';
import { ScreenerEngine } from '../decision/screener.js';
import { PortfolioEngine } from '../decision/portfolio-engine.js';
import { ExperimentTracker } from '../research/experiment-tracker.js';
import { fetchAndStore } from '../data/fetcher.js';
import { ModelRegistry } from '../research/model-registry.js';
import { ProbabilityCalibrator } from '../research/calibration.js';
import { PurgedCrossValidator } from '../research/purged-cv.js';
import { HrpOptimizer } from '../research/hrp.js';
import { TripleBarrierLabeler } from '../research/triple-barrier.js';
import { FillSimulator } from '../execution/fill-simulator.js';
import { SlippageModel } from '../execution/slippage-model.js';
import { ImplementationShortfallAnalyzer } from '../execution/implementation-shortfall.js';
import { OrderBookSimulator } from '../execution/order-book-simulator.js';
import { PositionStateMachine } from '../execution/position-state-machine.js';
import { OnlineLearner } from '../research/online-learning.js';
import { runBacktest } from '../research/backtester.js';
import { calculateQuantScore } from '../research/experiments/runner.js';
import { exportEquityCurve } from '../research/equity-export.js';
import { exportTradeJournal } from '../research/journal.js';
import { saveReport } from '../research/report.js';
import { createSmaCrossStrategy } from '../research/strategies/sma-cross/index.js';
import { createEmaCrossStrategy } from '../research/strategies/ema-cross/index.js';
import { createDonchianBreakoutStrategy } from '../research/strategies/donchian-breakout/index.js';
import { createConsensusStrategy } from '../research/strategies/consensus/index.js';
import { createA1Strategy } from '../research/strategies/a1/index.js';
import { createA2Strategy } from '../research/strategies/a2/index.js';
import { createTrendPullbackStrategy } from '../research/strategies/trend-pullback/index.js';
import { createFreedomStrategy } from '../research/strategies/freedom/index.js';
import { createFreedomBStrategy } from '../research/strategies/freedom_b/index.js';
import { createGemini1Strategy } from '../research/strategies/gemini_1/index.js';
import { createGemini2Strategy } from '../research/strategies/gemini_2/index.js';
import { createSupertrendStrategy } from '../research/strategies/supertrend/index.js';
import { createStrategyFromConfig } from '../research/strategies/factory/index.js';
import { CSVProvider } from '../data/csv-provider.js';

/**
 * REST API, WebSockets Event Bus ve HTML Visualizer sunucusunu başlatır.
 */
export function startDashboardServer(port: number = 3000): any {
	// Create WebSocket Server
	const wss = new WebSocketServer({ noServer: true });
	const connectedClients = new Set<WebSocket>();

	// Initialize Engines
	const screener = new ScreenerEngine();
	const portfolio = new PortfolioEngine();
	const tracker = new ExperimentTracker();
	const modelRegistry = new ModelRegistry();
	const calibrator = new ProbabilityCalibrator();
	const purgedValidator = new PurgedCrossValidator();
	const hrpOptimizer = new HrpOptimizer();
	const labeler = new TripleBarrierLabeler();
	const fillSimulator = new FillSimulator();
	const slippageModel = new SlippageModel();
	const shortfallAnalyzer = new ImplementationShortfallAnalyzer();
	const orderBook = new OrderBookSimulator();
	const positionStateMachine = new PositionStateMachine();
	const onlineLearner = new OnlineLearner();

	wss.on('connection', (ws) => {
		connectedClients.add(ws);
		log(`[WebSocket] New client connected. Total clients: ${connectedClients.size}`);

		// Immediately push current states to newly connected client
		const engineState = getExecutionEngineState('consensus', '15m');
		if (engineState) {
			ws.send(JSON.stringify({ type: 'engine', data: engineState }));
		}

		const screenerPath = join(process.cwd(), 'results', 'screener_state.json');
		if (existsSync(screenerPath)) {
			try {
				const s = JSON.parse(readFileSync(screenerPath, 'utf-8'));
				ws.send(JSON.stringify({ type: 'screener', data: s }));
			} catch {}
		}

		try {
			ws.send(JSON.stringify({ type: 'portfolio', data: portfolio.getPortfolioAllocations() }));
		} catch {}

		ws.on('close', () => {
			connectedClients.delete(ws);
			log(`[WebSocket] Client disconnected. Total clients: ${connectedClients.size}`);
		});
	});

	// Broadcast states to all UI connections
	function broadcastEngineState(state: EngineState) {
		const payload = JSON.stringify({ type: 'engine', data: state });
		for (const client of connectedClients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(payload);
			}
		}
	}

	function broadcastScreenerState(state: any) {
		const payload = JSON.stringify({ type: 'screener', data: state });
		for (const client of connectedClients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(payload);
			}
		}
	}

	function broadcastPortfolioState(state: any) {
		const payload = JSON.stringify({ type: 'portfolio', data: state });
		for (const client of connectedClients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(payload);
			}
		}
	}

	// Trigger initial screener scan in background on startup
	screener.scanAll().then(screenerState => {
		broadcastScreenerState(screenerState);
		broadcastPortfolioState(portfolio.getPortfolioAllocations());
	}).catch(e => logError(`Initial screener scan failed: ${e}`));

	// Repeat screener scan every 60 seconds
	const screenerInterval = setInterval(() => {
		screener.scanAll().then(screenerState => {
			broadcastScreenerState(screenerState);
			broadcastPortfolioState(portfolio.getPortfolioAllocations());
		}).catch(e => logError(`Periodic screener scan failed: ${e}`));
	}, 60000);

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? '/';

		// CORS Headers
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		try {
			// ── 1) GET /api/reports ──────────────────────────────────────────
			if (url === '/api/reports') {
				const resultsDir = join(process.cwd(), 'results');
				const reports: any[] = [];

				if (existsSync(resultsDir)) {
					const files = readdirSync(resultsDir);
					for (const file of files) {
						if (file.endsWith('.json') && file !== 'alpha_discovery_registry.json' && file !== 'live_paper_state.json' && file !== 'screener_state.json') {
							try {
								const path = join(resultsDir, file);
								const raw = readFileSync(path, 'utf-8');
								const data = JSON.parse(raw);
								if (data.initialCapital === undefined) {
									continue;
								}
								const stats = statSync(path);
								reports.push({
									filename: file,
									strategyName: data.strategyName || 'N/A',
									coin: data.coin || 'N/A',
									interval: data.interval || 'N/A',
									totalReturn: typeof data.totalReturn === 'number' ? data.totalReturn : 0,
									sharpeRatio: typeof data.sharpeRatio === 'number' ? data.sharpeRatio : 0,
									maxDrawdown: typeof data.maxDrawdown === 'number' ? data.maxDrawdown : 0,
									timestamp: data.endDate || '',
									createdAt: stats.mtimeMs
								});
							} catch (e) {
								// Hatalı dosyaları es geç
							}
						}
					}
				}

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(reports));
				return;
			}

			// ── 1c) POST /api/backtest/run ➔ Run a new backtest from UI ─────────
			if (url === '/api/backtest/run' && req.method === 'POST') {
				let body = '';
				req.on('data', chunk => { body += chunk; });
				req.on('end', async () => {
					try {
						const params = JSON.parse(body || '{}');
						const strategyName = params.strategy || 'ema-cross';
						const customName = params.customName ? String(params.customName).trim() : undefined;
						const coin = params.coin || 'BTCUSDT';
						const interval = params.interval || '1d';
						const fastPeriod = parseInt(params.fastPeriod || 9);
						const slowPeriod = parseInt(params.slowPeriod || 21);
						const donchianPeriod = parseInt(params.donchianPeriod || 20);
						const vwapPeriod = parseInt(params.vwapPeriod || 20);
						const vwapThreshold = parseFloat(params.vwapThreshold || 2.0);
						const bollingerPeriod = parseInt(params.bollingerPeriod || 20);
						const bollingerMultiplier = parseFloat(params.bollingerMultiplier || 2.0);
						const slPercent = params.stopLossPercent !== undefined ? parseFloat(params.stopLossPercent) : 0.05;
						const tpPercent = params.takeProfitPercent !== undefined ? parseFloat(params.takeProfitPercent) : 0.15;

						log(`[Server API] Running new backtest: ${strategyName} on ${coin} (${interval}). Params: ${JSON.stringify(params)}`);
						
						const startTime = params.startDate ? new Date(params.startDate).getTime() : undefined;
						const endTime = params.endDate ? new Date(params.endDate).getTime() : undefined;

						// 1) Fetch or load candles using incremental caching
						const candles = await fetchAndStore(coin, interval, { startTime, endTime, force: false });
						if (candles.length === 0) {
							throw new Error(`Market data not found for ${coin} / ${interval}`);
						}

						// 3) Resolve Strategy
						let strategy;
						if (strategyName === 'ema-cross') {
							strategy = createEmaCrossStrategy(fastPeriod, slowPeriod);
						} else if (strategyName === 'sma-cross') {
							strategy = createSmaCrossStrategy(fastPeriod, slowPeriod);
						} else if (strategyName === 'donchian-breakout' || strategyName === 'donchian') {
							strategy = createDonchianBreakoutStrategy(donchianPeriod);
						} else if (strategyName === 'consensus') {
							strategy = createConsensusStrategy();
						} else if (strategyName === 'a1') {
							strategy = createA1Strategy();
						} else if (strategyName === 'a2') {
							strategy = createA2Strategy();
						} else if (strategyName === 'supertrend') {
							const supertrendConfig = {
								metadata: {
									name: "supertrend-trend-lego",
									version: "1.0.0",
									tags: ["trend-following", "supertrend"],
									category: "Trend",
									author: "KriptoQuant Dashboard"
								},
								warmupPeriod: 50,
								indicators: [
									{
										id: "st",
										type: "supertrend",
										params: [10, 3.0]
									}
								],
								filters: [],
								entry: {
									type: "comparison",
									operator: "==",
									left: { type: "indicator", id: "st.direction" },
									right: { type: "constant", value: 1 }
								},
								exit: {
									type: "comparison",
									operator: "==",
									left: { type: "indicator", id: "st.direction" },
									right: { type: "constant", value: -1 }
								}
							};
							const compiled = createStrategyFromConfig(supertrendConfig as any, candles);
							strategy = compiled.strategy;
						} else if (strategyName === 'vwap-zscore') {
							const vwapConfig = {
								metadata: {
									name: "vwap-zscore-lego",
									version: "1.0.0",
									tags: ["mean-reversion", "vwap"],
									category: "Mean Reversion",
									author: "KriptoQuant Dashboard"
								},
								warmupPeriod: vwapPeriod,
								indicators: [
									{
										id: "vw",
										type: "vwap",
										params: [vwapPeriod]
									}
								],
								filters: [],
								entry: {
									type: "comparison",
									operator: "<",
									left: { type: "indicator", id: "vw" },
									right: { type: "constant", value: -vwapThreshold }
								},
								exit: {
									type: "comparison",
									operator: ">",
									left: { type: "indicator", id: "vw" },
									right: { type: "constant", value: vwapThreshold }
								}
							};
							const compiled = createStrategyFromConfig(vwapConfig as any, candles);
							strategy = compiled.strategy;
						} else if (strategyName === 'bollinger-bands') {
							const bollingerConfig = {
								metadata: {
									name: "bollinger-bands-lego",
									version: "1.0.0",
									tags: ["mean-reversion", "bollinger"],
									category: "Mean Reversion",
									author: "KriptoQuant Dashboard"
								},
								warmupPeriod: bollingerPeriod,
								indicators: [
									{
										id: "bb",
										type: "bollinger",
										params: [bollingerPeriod, bollingerMultiplier]
									}
								],
								filters: [],
								entry: {
									type: "comparison",
									operator: "<",
									left: { type: "indicator", id: "close" },
									right: { type: "indicator", id: "bb.lower" }
								},
								exit: {
									type: "comparison",
									operator: ">",
									left: { type: "indicator", id: "close" },
									right: { type: "indicator", id: "bb.upper" }
								}
							};
							const compiled = createStrategyFromConfig(bollingerConfig as any, candles);
							strategy = compiled.strategy;
						} else {
							strategy = createEmaCrossStrategy(fastPeriod, slowPeriod);
						}

						if (customName && strategy) {
							(strategy as any).name = customName;
						}

						// 4) Build configuration configs
						const defaultPath = join(process.cwd(), 'config', 'default.json');
						const riskPath = join(process.cwd(), 'config', 'risk.json');
						const defaultConf = existsSync(defaultPath) ? JSON.parse(readFileSync(defaultPath, 'utf-8')) : {};
						const riskConf = existsSync(riskPath) ? JSON.parse(readFileSync(riskPath, 'utf-8')) : {};

						const platformConfig = {
							initialCapital: defaultConf.initialCapital || 10000,
							commissionPercent: defaultConf.commissionPercent !== undefined ? defaultConf.commissionPercent : 0.10,
							slippagePercent: defaultConf.slippagePercent !== undefined ? defaultConf.slippagePercent : 0.05,
							makerFee: defaultConf.fees?.makerFee || 0.0002,
							takerFee: defaultConf.fees?.takerFee || 0.0004,
							slippageModel: defaultConf.execution?.slippageModel || 'linear',
						};

						const riskParams = {
							maxPositionPercent: params.maxPositionPercent !== undefined ? parseFloat(params.maxPositionPercent) : (riskConf.maxPositionPercent || 20),
							maxDailyLossPercent: riskConf.maxDailyLossPercent || 5,
							maxOrderValue: params.maxOrderValue !== undefined ? parseFloat(params.maxOrderValue) : (riskConf.maxOrderValue || 2000),
							stopLossAtrMultiplier: params.stopLossAtrMultiplier !== undefined ? parseFloat(params.stopLossAtrMultiplier) : (riskConf.stopLossAtrMultiplier || 2),
							stopLossPercent: slPercent,
							takeProfitPercent: tpPercent,
							cvarThresholdPercent: riskConf.cvarThresholdPercent || 0.12,
							ruinProbabilityLimit: riskConf.ruinProbabilityLimit || 0.05,
						};

						// 5) Execute backtest
						const disableFilters = params.disableFilters === true;
						let strategyDefaults;
						if (disableFilters) {
							strategyDefaults = {
								strategies: { emaCross: { fast: 9, slow: 21 }, smaCross: { fast: 10, slow: 30 } },
								filters: { adxPeriod: 14, adxVetoThreshold: 0, rvolLookback: 20, rvolVetoThreshold: 0 },
								confidence: { baseScore: 40, adxStrongThreshold: 25, adxStrongBonus: 0, rvolHighThreshold: 2.0, rvolHighBonus: 0, minimumScore: 0 }
							};
						}

						const result = runBacktest(strategy, candles, platformConfig, riskParams, coin, strategyDefaults);
						const scoreVal = calculateQuantScore(result);
						const enrichedResult = {
							...result,
							quantScore: scoreVal,
							interval,
							riskConfig: {
								stopLossPercent: riskParams.stopLossPercent,
								takeProfitPercent: riskParams.takeProfitPercent,
								stopLossAtrMultiplier: riskParams.stopLossAtrMultiplier,
								maxPositionPercent: riskParams.maxPositionPercent,
								maxOrderValue: riskParams.maxOrderValue
							}
						};

						// 6) Save report and exports
						const reportFile = saveReport(enrichedResult);
						exportTradeJournal(enrichedResult);
						exportEquityCurve(enrichedResult);

						const reportName = basename(reportFile);
						log(`[Server API] Backtest completed successfully! Report saved to results/${reportName}`);

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: true, filename: reportName }));
					} catch (e) {
						logError(`[Server API] Backtest failed: ${e}`);
						res.writeHead(500, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: false, message: e instanceof Error ? e.message : String(e) }));
					}
				});
				return;
			}

			// ── 1b) GET /api/discovery ───────────────────────────────────────
			if (url === '/api/discovery') {
				const filePath = join(process.cwd(), 'results', 'alpha_discovery_registry.json');
				if (existsSync(filePath)) {
					const raw = readFileSync(filePath, 'utf-8');
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(raw);
				} else {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ totalCandidates: 0, passedCandidates: 0, results: [] }));
				}
				return;
			}

			// ── 1c) GET /api/live-paper ➔ Canlı Paper Trading Durumu (Summary) ──
			if (url === '/api/live-paper' && req.method === 'GET') {
				const summaries = getAllExecutionEnginesSummary();
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(summaries));
				return;
			}

			// ── 1cc) GET /api/live-paper/details ➔ Detaylı Strateji Durumu ──────
			if (url.startsWith('/api/live-paper/details') && req.method === 'GET') {
				const queryParams = new URL(`http://localhost${url}`).searchParams;
				const strategy = queryParams.get('strategy') || 'consensus';
				const interval = queryParams.get('interval') || '15m';
				const state = getExecutionEngineState(strategy, interval);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(state || { engineStatus: 'stopped' }));
				return;
			}

			// ── 1ccc) GET /api/live-paper/all-states ➔ Tüm Stratejilerin Durumu ──
			if (url === '/api/live-paper/all-states' && req.method === 'GET') {
				const states: any[] = [];
				const registeredStrategies = ['consensus', 'a1', 'a2', 'donchian-breakout', 'ema-cross', 'supertrend', 'bollinger-bands', 'trend-pullback', 'freedom', 'freedom_b', 'gemini_1', 'gemini_2'];
				const intervals = ['15m', '1h', '4h'];
				for (const strat of registeredStrategies) {
					for (const intv of intervals) {
						const state = getExecutionEngineState(strat, intv);
						if (state) {
							states.push({
								strategy: strat,
								interval: intv,
								engineStatus: state.engineStatus,
								activePositions: state.activePositions || [],
								closedTrades: state.closedTrades || []
							});
						}
					}
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(states));
				return;
			}

			// ── 1cccc) GET /api/live-paper/export-csv ➔ İşlem geçmişini CSV olarak indir ──
			if (url === '/api/live-paper/export-csv' && req.method === 'GET') {
				const registeredStrategies = ['consensus', 'a1', 'a2', 'donchian-breakout', 'ema-cross', 'supertrend', 'bollinger-bands', 'trend-pullback', 'freedom', 'freedom_b', 'gemini_1', 'gemini_2'];
				const intervals = ['15m', '1h', '4h'];
				const closedTrades: any[] = [];

				for (const strat of registeredStrategies) {
					for (const intv of intervals) {
						const state = getExecutionEngineState(strat, intv);
						if (state && state.closedTrades && Array.isArray(state.closedTrades)) {
							for (const trade of state.closedTrades) {
								closedTrades.push({
									strategy: strat,
									coin: trade.coin,
									entryTime: trade.entryTime,
									exitTime: trade.exitTime,
									entryPrice: trade.entryPrice,
									exitPrice: trade.exitPrice,
									quantity: trade.quantity || 0,
									pnlPercent: trade.realizedPnLPercent || 0,
									pnlUsdt: trade.realizedPnLUsdt || 0,
									reason: trade.exitReason,
									durationSeconds: trade.holdingDurationSeconds || 0
								});
							}
						}
					}
				}

				closedTrades.sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime());

				const bom = '\uFEFF';
				const headers = ['Strategy', 'Coin', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Quantity', 'PnL %', 'PnL $', 'Exit Reason', 'Duration (Seconds)'];
				const csvRows = [headers.join(';')];

				for (const t of closedTrades) {
					const row = [
						t.strategy,
						t.coin,
						t.entryTime,
						t.exitTime,
						t.entryPrice,
						t.exitPrice,
						t.quantity,
						t.pnlPercent.toFixed(4),
						t.pnlUsdt.toFixed(2),
						t.reason,
						t.durationSeconds
					];
					csvRows.push(row.map(val => `"${val}"`).join(';'));
				}

				res.writeHead(200, {
					'Content-Type': 'text/csv; charset=utf-8',
					'Content-Disposition': 'attachment; filename="all_live_closed_trades.csv"'
				});
				res.end(bom + csvRows.join('\n'));
				return;
			}

			// ── 1d) POST /api/live-paper/start ➔ Motoru Canlı Başlat ──────────
			if (url === '/api/live-paper/start' && req.method === 'POST') {
				let body = '';
				req.on('data', chunk => { body += chunk; });
				req.on('end', async () => {
					try {
						const params = JSON.parse(body || '{}');
						const strategy = params.strategy || 'ema-cross';
						const coins = params.coins || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
						const interval = params.interval || '15m';
						const mlVeto = !!params.mlVeto;

						log(`Deploying to Paper: Strategy = ${strategy}, Coins = ${coins.join(', ')}, Interval = ${interval}, ML Veto = ${mlVeto}`);
						
						// Start live in-process engine
						await startExecutionEngine(coins, interval, strategy, mlVeto, (state) => {
							broadcastEngineState(state);
							broadcastPortfolioState(portfolio.getPortfolioAllocations());
						});

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: true, message: 'Execution Engine started' }));
					} catch (e) {
						logError(`Failed to start execution engine: ${e}`);
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end(`Start Engine Failed: ${e instanceof Error ? e.message : String(e)}`);
					}
				});
				return;
			}

			// ── 1e) POST /api/live-paper/stop ➔ Motoru Durdur ─────────────────
			if (url === '/api/live-paper/stop' && req.method === 'POST') {
				let body = '';
				req.on('data', chunk => { body += chunk; });
				req.on('end', () => {
					try {
						const params = JSON.parse(body || '{}');
						const strategy = params.strategy || 'ema-cross';
						const interval = params.interval || '15m';
						
						stopExecutionEngine(strategy, interval);
						const stoppedState = getExecutionEngineState(strategy, interval);
						if (stoppedState) {
							broadcastEngineState(stoppedState);
						}
						broadcastPortfolioState(portfolio.getPortfolioAllocations());

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: true, message: `Execution Engine stopped for ${strategy} (${interval})` }));
					} catch (e) {
						logError(`Failed to stop execution engine: ${e}`);
						res.writeHead(500, { 'Content-Type': 'text/plain' });
						res.end(`Stop Engine Failed: ${e}`);
					}
				});
				return;
			}

			// ── 1f) GET /api/screener ➔ Canlı Screener & Fırsat Listesi ───────
			if (url === '/api/screener' && req.method === 'GET') {
				const screenerPath = join(process.cwd(), 'results', 'screener_state.json');
				if (existsSync(screenerPath)) {
					const raw = readFileSync(screenerPath, 'utf-8');
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(raw);
				} else {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ lastUpdated: '', items: [] }));
				}
				return;
			}

			// ── 1g) GET /api/portfolio ➔ Portföy Dağılım Verileri ─────────────
			if (url === '/api/portfolio' && req.method === 'GET') {
				try {
					const allocs = portfolio.getPortfolioAllocations();
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(allocs));
				} catch (e) {
					res.writeHead(500, { 'Content-Type': 'text/plain' });
					res.end(`Failed to get portfolio: ${e}`);
				}
				return;
			}

			// ── 1h) GET /api/research/experiments ➔ Deney Listesi ────────────────
			if (url === '/api/research/experiments' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(tracker.getExperiments()));
				return;
			}



			// ── 1j) GET /api/research/models ➔ Model Registry ───────────────────
			if (url === '/api/research/models' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(modelRegistry.getModels()));
				return;
			}

			// ── 1k) POST /api/research/models/status ➔ Model Status Güncelleme ────
			if (url === '/api/research/models/status' && req.method === 'POST') {
				let body = '';
				req.on('data', chunk => { body += chunk; });
				req.on('end', () => {
					try {
						const { modelId, status } = JSON.parse(body);
						const success = modelRegistry.updateModelStatus(modelId, status);
						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success }));
					} catch (e) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: false, error: String(e) }));
					}
				});
				return;
			}

			// ── 1l) GET /api/research/calibration ➔ Calibration Curve Points ───
			if (url === '/api/research/calibration' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(calibrator.getCalibrationCurvePoints()));
				return;
			}

			// ── 1m) GET /api/research/walkforward-stats ➔ Walk-Forward Stats ────
			if (url === '/api/research/walkforward-stats' && req.method === 'GET') {
				const sharpes = [1.45, 1.88, 1.62];
				const stats = purgedValidator.saveWalkforwardStats(sharpes);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(stats));
				return;
			}

			// ── 1n) GET /api/research/hrp ➔ Hierarchical Risk Parity ────────────
			if (url === '/api/research/hrp' && req.method === 'GET') {
				const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'AVAXUSDT'];
				const corr = [
					[1.00, 0.85, 0.68, 0.60, 0.58],
					[0.85, 1.00, 0.72, 0.65, 0.62],
					[0.68, 0.72, 1.00, 0.58, 0.55],
					[0.60, 0.65, 0.58, 1.00, 0.50],
					[0.58, 0.62, 0.55, 0.50, 1.00]
				];
				const vols = [0.022, 0.031, 0.048, 0.055, 0.058];
				const result = hrpOptimizer.calculateHrpWeights(coins, corr, vols);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));
				return;
			}

			// ── 1o) GET /api/research/label-distribution ➔ Dynamic Triple Barrier Label Percentages ──
			if (url === '/api/research/label-distribution' && req.method === 'GET') {
				// Mock 100 observations to calculate label distribution empirically
				const mockObs = Array.from({ length: 100 }, () => ({
					timestamp: Date.now(),
					price: 100,
					upperBarrier: 102,
					lowerBarrier: 99,
					label: (Math.random() > 0.4 ? (Math.random() > 0.33 ? 1 : -1) : 0) as any
				}));
				const dist = labeler.saveLabelDistribution(mockObs);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(dist));
				return;
			}

			// ── 1p) GET /api/execution/simulate ➔ Execution Realism Simulator ───
			if (url.startsWith('/api/execution/simulate') && req.method === 'GET') {
				const mockCandle = {
					openTime: Date.now(),
					open: 100,
					high: 103,
					low: 98,
					close: 101,
					volume: 5000,
					closeTime: Date.now() + 60000
				};
				const fill = fillSimulator.simulateOrderFill(101, mockCandle, 120, 15000);
				const cost = slippageModel.calculateTotalExecutionCost(150, 101, 0.03, true);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ fill, cost }));
				return;
			}

			// ── 1q) GET /api/execution/tca-details ➔ Implementation Shortfall Ratios ─
			if (url.startsWith('/api/execution/tca-details') && req.method === 'GET') {
				const params = new URL(url, `http://${req.headers.host}`).searchParams;
				const size = parseFloat(params.get('size') || '25000');
				
				const report = shortfallAnalyzer.analyzeShortfall(100.0, 100.15, 100.38, size / 100, 'BUY', (size * 0.001));
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(report));
				return;
			}

			// ── 1r) GET /api/execution/order-book ➔ L2 matching book depth ────
			if (url === '/api/execution/order-book' && req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(orderBook.getL2Depth()));
				return;
			}



			// ── 2) GET & DELETE /api/reports/:filename ───────────────────────
			if (url.startsWith('/api/reports/')) {
				const filename = decodeURIComponent(url.substring('/api/reports/'.length));
				if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
					res.writeHead(400, { 'Content-Type': 'text/plain' });
					res.end('Bad Request');
					return;
				}

				const resultsDir = join(process.cwd(), 'results');
				const filePath = join(resultsDir, filename);

				if (req.method === 'DELETE') {
					if (existsSync(filePath)) {
						unlinkSync(filePath);
						const baseName = filename.replace('.json', '');
						const csvFiles = [
							join(resultsDir, `equity_${baseName}.csv`),
							join(resultsDir, `journal_${baseName}.csv`),
							join(resultsDir, `signals_${baseName}.csv`)
						];
						csvFiles.forEach(f => {
							if (existsSync(f)) {
								try { unlinkSync(f); } catch (e) {}
							}
						});

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: true }));
					} else {
						res.writeHead(404, { 'Content-Type': 'text/plain' });
						res.end('Report Not Found');
					}
					return;
				}

				if (existsSync(filePath)) {
					const raw = readFileSync(filePath, 'utf-8');
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(raw);
				} else {
					res.writeHead(404, { 'Content-Type': 'text/plain' });
					res.end('Report Not Found');
				}
				return;
			}

			// ── 3) GET / ➔ HTML Dashboard SPA ────────────────────────────────
			if (url === '/' || url === '/index.html') {
				const indexPath = join(process.cwd(), 'src', 'dashboard', 'index.html');
				if (existsSync(indexPath)) {
					const html = readFileSync(indexPath, 'utf-8');
					res.writeHead(200, { 'Content-Type': 'text/html' });
					res.end(html);
				} else {
					res.writeHead(404, { 'Content-Type': 'text/plain' });
					res.end('index.html template not found under src/dashboard/');
				}
				return;
			}

			// 404
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not Found');

		} catch (err) {
			logError(`Dashboard Sunucu Hatası: ${err instanceof Error ? err.message : String(err)}`);
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			res.end('Internal Server Error');
		}
	});

	// Upgrade HTTP server connection to WebSockets if path is /ws/live
	server.on('upgrade', (req, socket, head) => {
		const pathname = req.url ?? '';
		if (pathname === '/ws/live') {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit('connection', ws, req);
			});
		} else {
			socket.destroy();
		}
	});

	server.listen(port, () => {
		log(`\n================================================================`);
		log(`  📊 KRIPTOQUANT DASHBOARD SERVER RUNNING`);
		log(`  🚀 URL: http://localhost:${port}`);
		log(`================================================================\n`);

		// Check for auto-resume on server startup for all strategies & intervals
		try {
			const registeredStrategies = ['consensus', 'a1', 'a2', 'donchian-breakout', 'ema-cross', 'supertrend', 'bollinger-bands', 'trend-pullback', 'freedom', 'freedom_b', 'gemini_1', 'gemini_2'];
			const intervals = ['15m', '1h', '4h'];
			for (const strat of registeredStrategies) {
				for (const interval of intervals) {
					const state = getExecutionEngineState(strat, interval);
					if (state && state.engineStatus === 'running' && state.coins && state.interval && state.strategyPath) {
						log(`[Auto-Resume] Resuming previously running ExecutionEngine for ${strat} (${interval}) with ${state.coins.length} coins...`);
						startExecutionEngine(state.coins, state.interval, state.strategyPath, !!state.mlVeto, (updatedState) => {
							broadcastEngineState(updatedState);
							broadcastPortfolioState(portfolio.getPortfolioAllocations());
						}).catch(e => {
							logError(`[Auto-Resume] Failed to resume ExecutionEngine for ${strat} (${interval}): ${e}`);
						});
					}
				}
			}
		} catch (e) {
			logError(`[Auto-Resume] Error during checking auto-resume state: ${e}`);
		}
	});

	return server;
}
