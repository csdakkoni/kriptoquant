// ============================================================================
// KRIPTOQUANT — Dashboard Server (Organism Edition)
// ============================================================================
// Serves the Research Organism dashboard and provides API endpoints
// for the Assumption Killer, Knowledge Graph, and Journal.
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';
import { buildReportHtml } from './report.js';

// Testlerin gerçek durumu ezmemesi için dizin ORGANISM_DATA_DIR ile değiştirilebilir
const ORGANISM_DIR = process.env.ORGANISM_DATA_DIR || join(process.cwd(), 'organism-data');
const GRAPH_FILE = join(ORGANISM_DIR, 'knowledge-graph.json');

function json(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
	res.end(JSON.stringify(data));
}

// Canlı fiyat önbelleği — açık pozisyonların anlık PnL'i için (15 sn'de bir tazelenir)
let priceCache: { data: Record<string, number>; fetchedAt: number } = { data: {}, fetchedAt: 0 };

async function getPrices(): Promise<Record<string, number>> {
	const now = Date.now();
	if (now - priceCache.fetchedAt < 15_000 && Object.keys(priceCache.data).length > 0) {
		return priceCache.data;
	}
	try {
		const res = await fetch('https://api.binance.com/api/v3/ticker/price');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const list = (await res.json()) as { symbol: string; price: string }[];
		const map: Record<string, number> = {};
		for (const t of list) {
			if (t.symbol.endsWith('USDT')) map[t.symbol] = parseFloat(t.price);
		}
		priceCache = { data: map, fetchedAt: now };
	} catch (e) {
		logError(`[Dashboard] Fiyat çekilemedi (önbellek kullanılıyor): ${e}`);
	}
	return priceCache.data;
}

export function startDashboardServer(port: number = 3000): any {
	const wss = new WebSocketServer({ noServer: true });
	const connectedClients = new Set<WebSocket>();

	wss.on('connection', (ws) => {
		connectedClients.add(ws);
		ws.on('close', () => connectedClients.delete(ws));
	});

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? '/';

		// ─── API Routes ──────────────────────────────────────────────

		// Knowledge graph
		if (url === '/api/organism/knowledge') {
			try {
				if (existsSync(GRAPH_FILE)) {
					const data = JSON.parse(readFileSync(GRAPH_FILE, 'utf-8'));
					return json(res, data);
				}
				return json(res, { nodes: [], edges: [] });
			} catch { return json(res, { nodes: [], edges: [] }, 500); }
		}

		// Recent observations (last 50 from knowledge graph)
		if (url === '/api/organism/observations') {
			try {
				if (existsSync(GRAPH_FILE)) {
					const data = JSON.parse(readFileSync(GRAPH_FILE, 'utf-8'));
					const observations = (data.nodes || [])
						.filter((n: any) => n.type === 'observation')
						.sort((a: any, b: any) => b.timestamp - a.timestamp)
						.slice(0, 100);
					return json(res, observations);
				}
				return json(res, []);
			} catch { return json(res, [], 500); }
		}

		// Piyasa rejimi (BULL / BEAR / CHOP)
		if (url === '/api/organism/regime') {
			try {
				const rgFile = join(ORGANISM_DIR, 'regime.json');
				if (existsSync(rgFile)) {
					return json(res, JSON.parse(readFileSync(rgFile, 'utf-8')));
				}
				return json(res, { state: 'UNKNOWN' });
			} catch { return json(res, { state: 'UNKNOWN' }, 500); }
		}

		// Gözlem Karnesi — gözlem tiplerinin sinyal kalitesi
		if (url === '/api/organism/scoreboard') {
			try {
				const sbFile = join(ORGANISM_DIR, 'observation-scoreboard.json');
				if (existsSync(sbFile)) {
					return json(res, JSON.parse(readFileSync(sbFile, 'utf-8')));
				}
				return json(res, { pending: [], scores: {} });
			} catch { return json(res, { pending: [], scores: {} }, 500); }
		}

		// Canlı fiyatlar (açık pozisyon PnL'i için)
		if (url === '/api/organism/prices') {
			getPrices()
				.then((prices) => json(res, prices))
				.catch(() => json(res, {}, 500));
			return;
		}

		// Experiments
		if (url === '/api/organism/experiments') {
			try {
				const expFile = join(ORGANISM_DIR, 'experiments.json');
				if (existsSync(expFile)) {
					const data = JSON.parse(readFileSync(expFile, 'utf-8'));
					return json(res, data);
				}
				return json(res, []);
			} catch { return json(res, [], 500); }
		}

		// ─── Report Page ────────────────────────────────────────────
		if (url === '/rapor') {
			try {
				const readJ = (f: string) => {
					const p = join(ORGANISM_DIR, f);
					if (!existsSync(p)) return null;
					try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
				};
				const html = buildReportHtml({
					experiments: readJ('experiments.json') || [],
					scoreboard: readJ('observation-scoreboard.json'),
					regime: readJ('regime.json'),
				});
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(html);
				return;
			} catch (e) {
				logError(`[Dashboard] Rapor oluşturulamadı: ${e}`);
				res.writeHead(500);
				res.end('Rapor oluşturulamadı: ' + e);
				return;
			}
		}

		// ─── HTML Dashboard ──────────────────────────────────────────
		if (url === '/' || url === '/index.html') {
			const htmlPath = join(import.meta.dirname, 'index.html');
			if (existsSync(htmlPath)) {
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(readFileSync(htmlPath, 'utf-8'));
				return;
			}
			res.writeHead(404);
			res.end('index.html not found');
			return;
		}

		// 404
		res.writeHead(404);
		res.end('Not Found');
	});

	server.on('upgrade', (req, socket, head) => {
		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit('connection', ws, req);
		});
	});

	server.listen(port, () => {
		log(`[Dashboard] Research Organism dashboard running at http://localhost:${port}`);
	});

	return server;
}
