// ============================================================================
// KRIPTOQUANT — Dashboard Local HTTP Server & Event Bus (Sprint 28)
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';
import {
	startExecutionEngine,
	stopExecutionEngine,
	getExecutionEngineState,
	getAllExecutionEnginesSummary,
	resetExecutionEngineState,
	EngineState,
	LIVE_STRATEGY_ROSTER,
} from '../live/live-engine.js';
import { fetchAndStore } from '../data/fetcher.js';
import { createEmaCrossStrategy } from '../research/strategies/ema-cross/index.js';
import { createDonchianBreakoutStrategy } from '../research/strategies/donchian-breakout/index.js';
import { createStrategyFromConfig } from '../research/strategies/factory/index.js';

/**
 * REST API, WebSockets Event Bus ve HTML Visualizer sunucusunu başlatır.
 */
const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit for POST request bodies

export function startDashboardServer(port: number = 3000): any {
	// Create WebSocket Server
	const wss = new WebSocketServer({ noServer: true });
	const connectedClients = new Set<WebSocket>();



	wss.on('connection', (ws) => {
		connectedClients.add(ws);
		log(`[WebSocket] New client connected. Total clients: ${connectedClients.size}`);

		// Immediately push current states to newly connected client
		const engineState = getExecutionEngineState('consensus', '15m');
		if (engineState) {
			ws.send(JSON.stringify({ type: 'engine', data: engineState }));
		}



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
				const strategy = queryParams.get('strategy') || 'a2-v2';
				const interval = queryParams.get('interval') || '15m';
				const state = getExecutionEngineState(strategy, interval);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(state || { engineStatus: 'stopped' }));
				return;
			}

			// ── 1ccc) GET /api/live-paper/all-states ➔ Tüm Stratejilerin Durumu ──
			if (url === '/api/live-paper/all-states' && req.method === 'GET') {
				const states: any[] = [];
				for (const { name: strat, interval: intv } of LIVE_STRATEGY_ROSTER) {
					{
						const state = getExecutionEngineState(strat, intv);
						if (state) {
							states.push({
								strategy: strat,
								interval: intv,
								engineStatus: state.engineStatus,
								cash: state.cash,
								currentEquity: state.currentEquity || state.cash,
								realizedPnL: state.realizedPnL || 0,
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
				const closedTrades: any[] = [];

				for (const { name: strat, interval: intv } of LIVE_STRATEGY_ROSTER) {
					{
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
				req.on('data', chunk => {
					body += chunk;
					if (body.length > MAX_BODY_SIZE) {
						req.destroy();
						res.writeHead(413, { 'Content-Type': 'text/plain' });
						res.end('Request body too large');
						return;
					}
				});
				req.on('end', async () => {
					try {
						const params = JSON.parse(body || '{}');
						const strategy = params.strategy || 'ema-cross';
						const coins = params.coins || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
						const interval = params.interval || '15m';

						log(`Deploying to Paper: Strategy = ${strategy}, Coins = ${coins.join(', ')}, Interval = ${interval}`);

						// Start live in-process engine instantly (skip startup delay)
						await startExecutionEngine(coins, interval, strategy, (state) => {
							broadcastEngineState(state);
						}, true);

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
				req.on('data', chunk => {
					body += chunk;
					if (body.length > MAX_BODY_SIZE) {
						req.destroy();
						res.writeHead(413, { 'Content-Type': 'text/plain' });
						res.end('Request body too large');
						return;
					}
				});
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

			// ── 1ee) POST /api/live-paper/reset ➔ Strateji Kasasını Sıfırla ──────────
			if (url === '/api/live-paper/reset' && req.method === 'POST') {
				let body = '';
				req.on('data', chunk => {
					body += chunk;
					if (body.length > MAX_BODY_SIZE) {
						req.destroy();
						res.writeHead(413, { 'Content-Type': 'text/plain' });
						res.end('Request body too large');
						return;
					}
				});
				req.on('end', async () => {
					try {
						const params = JSON.parse(body || '{}');
						const strategy = params.strategy || 'ema-cross';
						const interval = params.interval || '15m';

						log(`Resetting state for strategy: ${strategy} (${interval})`);

						// Reset state file and cache
						const resetState = await resetExecutionEngineState(strategy, interval);

						// Broadcast stopped/reset state
						broadcastEngineState(resetState);

						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: true, message: `Execution Engine state reset for ${strategy} (${interval})` }));
					} catch (e) {
						logError(`Failed to reset execution engine: ${e}`);
						res.writeHead(500, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: String(e) }));
					}
				});
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
			for (const { name: strat, interval } of LIVE_STRATEGY_ROSTER) {
				const state = getExecutionEngineState(strat, interval);
				if (state && state.engineStatus === 'running' && state.coins && state.interval && state.strategyPath) {
					log(`[Auto-Resume] Resuming previously running ExecutionEngine for ${strat} (${interval}) with ${state.coins.length} coins...`);
					startExecutionEngine(state.coins, state.interval, state.strategyPath, (updatedState) => {
						broadcastEngineState(updatedState);
					}).catch(e => {
						logError(`[Auto-Resume] Failed to resume ExecutionEngine for ${strat} (${interval}): ${e}`);
					});
				}
			}
		} catch (e) {
			logError(`[Auto-Resume] Error during checking auto-resume state: ${e}`);
		}
	});

	return server;
}
