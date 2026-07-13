// ============================================================================
// KRIPTOQUANT — Dashboard Server (Organism Edition)
// ============================================================================
// Serves the Research Organism dashboard and provides API endpoints
// for the Assumption Killer, Knowledge Graph, and Journal.
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { log, logError } from '../core/utils.js';

const ORGANISM_DIR = join(process.cwd(), 'organism-data');
const STATE_FILE = join(ORGANISM_DIR, 'assumptions-state.json');
const GRAPH_FILE = join(ORGANISM_DIR, 'knowledge-graph.json');
const JOURNAL_DIR = join(ORGANISM_DIR, 'journal');

function json(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
	res.end(JSON.stringify(data));
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

		// Assumptions state
		if (url === '/api/organism/assumptions') {
			try {
				if (existsSync(STATE_FILE)) {
					const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
					return json(res, data);
				}
				return json(res, []);
			} catch { return json(res, [], 500); }
		}

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

		// Journal entries
		if (url === '/api/organism/journal') {
			try {
				if (existsSync(JOURNAL_DIR)) {
					const entries = readdirSync(JOURNAL_DIR)
						.filter(f => f.endsWith('.json'))
						.sort()
						.reverse()
						.slice(0, 30)
						.map(f => {
							try { return JSON.parse(readFileSync(join(JOURNAL_DIR, f), 'utf-8')); }
							catch { return null; }
						})
						.filter(Boolean);
					return json(res, entries);
				}
				return json(res, []);
			} catch { return json(res, [], 500); }
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
