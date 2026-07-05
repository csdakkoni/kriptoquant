// ============================================================================
// KRIPTOQUANT — Dashboard Local HTTP Server & Event Bus (Sprint 26)
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';
import {
	startExecutionEngine,
	stopExecutionEngine,
	getExecutionEngineState,
	EngineState,
} from '../live/live-engine.js';

/**
 * REST API, WebSockets Event Bus ve HTML Visualizer sunucusunu başlatır.
 */
export function startDashboardServer(port: number = 3000): any {
	// Create WebSocket Server
	const wss = new WebSocketServer({ noServer: true });
	const connectedClients = new Set<WebSocket>();

	wss.on('connection', (ws) => {
		connectedClients.add(ws);
		log(`[WebSocket] New client connected. Total clients: ${connectedClients.size}`);

		// Immediately push current engine state to newly connected client
		const state = getExecutionEngineState();
		if (state) {
			ws.send(JSON.stringify(state));
		}

		ws.on('close', () => {
			connectedClients.delete(ws);
			log(`[WebSocket] Client disconnected. Total clients: ${connectedClients.size}`);
		});
	});

	// Broadcast live engine state to all UI browser connections
	function broadcastState(state: EngineState) {
		const payload = JSON.stringify(state);
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
						if (file.endsWith('.json') && file !== 'alpha_discovery_registry.json' && file !== 'live_paper_state.json') {
							try {
								const path = join(resultsDir, file);
								const raw = readFileSync(path, 'utf-8');
								const data = JSON.parse(raw);
								if (data.initialCapital === undefined) {
									continue;
								}
								reports.push({
									filename: file,
									strategyName: data.strategyName || 'N/A',
									coin: data.coin || 'N/A',
									interval: data.interval || 'N/A',
									totalReturn: typeof data.totalReturn === 'number' ? data.totalReturn : 0,
									sharpeRatio: typeof data.sharpeRatio === 'number' ? data.sharpeRatio : 0,
									maxDrawdown: typeof data.maxDrawdown === 'number' ? data.maxDrawdown : 0,
									timestamp: data.endDate || '',
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

			// ── 1c) GET /api/live-paper ➔ Canlı Paper Trading Durumu ──────────
			if (url === '/api/live-paper' && req.method === 'GET') {
				const state = getExecutionEngineState();
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(state || { engineStatus: 'stopped' }));
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
						const interval = params.interval || '1m';

						log(`Deploying to Paper: Strategy = ${strategy}, Coins = ${coins.join(', ')}, Interval = ${interval}`);
						
						// Start live in-process engine
						await startExecutionEngine(coins, interval, strategy, (state) => {
							broadcastState(state);
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
				try {
					stopExecutionEngine();
					// Broadcast stopped state
					const stoppedState = getExecutionEngineState();
					if (stoppedState) broadcastState(stoppedState);

					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: true, message: 'Execution Engine stopped' }));
				} catch (e) {
					logError(`Failed to stop execution engine: ${e}`);
					res.writeHead(500, { 'Content-Type': 'text/plain' });
					res.end(`Stop Engine Failed: ${e}`);
				}
				return;
			}

			// ── 2) GET /api/reports/:filename ────────────────────────────────
			if (url.startsWith('/api/reports/')) {
				const filename = decodeURIComponent(url.substring('/api/reports/'.length));
				if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
					res.writeHead(400, { 'Content-Type': 'text/plain' });
					res.end('Bad Request');
					return;
				}

				const resultsDir = join(process.cwd(), 'results');
				const filePath = join(resultsDir, filename);

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
	});

	return server;
}
