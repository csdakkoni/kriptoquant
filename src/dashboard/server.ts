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
				const assumptions: any[] = readJ('assumptions-state.json') || [];
				const experiments: any[] = readJ('experiments.json') || [];
				const sb: any = readJ('observation-scoreboard.json');
				const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
				const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

				// Assumptions
				let assumptionRows = '';
				for (const a of assumptions) {
					const f = (a.evidence || []).filter((e: any) => e.supports).length;
					const g = (a.evidence || []).length - f;
					const icon: any = { alive: '🟢', killed: '💀', testing: '🔬', queued: '⏳' };
					const sc = a.status === 'killed' ? 'color:#ef4444' : a.status === 'alive' ? 'color:#10b981' : 'color:#6366f1';
					assumptionRows += `<tr><td style="${sc};font-weight:600">${icon[a.status]||'❓'} ${(a.status||'').toUpperCase()}</td><td>${a.statement}</td><td style="text-align:center">+${f} / -${g}</td><td style="font-size:11px;color:#666">${a.verdict || '—'}</td></tr>`;
				}

				// Experiments
				const running = experiments.filter(e => e.status === 'running');
				const sorted = [...running].sort((a, b) => (b.stats?.totalPnlPercent || 0) - (a.stats?.totalPnlPercent || 0));
				let expRows = '';
				for (const e of sorted) {
					const s = e.stats || {};
					const pnlVal = s.totalPnlPercent || 0;
					const pc = pnlVal > 0 ? '#10b981' : pnlVal < 0 ? '#ef4444' : '#666';
					const side = e.name?.includes('SHORT') || e.side === 'short' ? '🔻 SHORT' : '🔺 LONG';
					const open = (e.positions || []).filter((p: any) => !p.exitPrice).length;
					expRows += `<tr><td>${e.name}${e.promoted ? ' ⭐' : ''}</td><td style="text-align:center">${side}</td><td style="text-align:center">${s.totalTrades || 0}</td><td style="text-align:center">${(s.winRate || 0).toFixed(0)}%</td><td style="text-align:center;font-weight:700;color:${pc}">${pct(pnlVal)}</td><td style="text-align:center">${open}</td></tr>`;
				}

				// Trades
				const allClosed = experiments.flatMap((e: any) => (e.closedPositions || []).map((p: any) => ({...p, expName: e.name})));
				allClosed.sort((a: any, b: any) => (b.exitTime || 0) - (a.exitTime || 0));
				const wins = allClosed.filter((p: any) => (p.pnlPercent || 0) > 0).length;
				const totalPnl = allClosed.reduce((s: number, p: any) => s + (p.pnlPercent || 0), 0);
				const exitMap: any = { take_profit:'Kâr Al', stop_loss:'Zarar Kes', trailing_stop:'İz Süren', fixed_exit:'Süre Doldu', experiment_end:'Deney Bitti' };
				let tradeRows = '';
				for (const t of allClosed.slice(0, 100)) {
					const pv = t.pnlPercent || 0;
					const pc = pv > 0 ? '#10b981' : pv < 0 ? '#ef4444' : '#666';
					tradeRows += `<tr><td>${(t.coin||'').replace('USDT','')}</td><td>${t.side||'long'}</td><td>${t.entryPrice?.toFixed(2)||'—'}</td><td>${t.exitPrice?.toFixed(2)||'—'}</td><td style="font-weight:600;color:${pc}">${pct(pv)}</td><td>${exitMap[t.exitReason]||t.exitReason||'?'}</td><td style="font-size:11px;color:#888">${t.expName||'—'}</td><td style="font-size:11px;color:#888">${t.exitTime ? new Date(t.exitTime).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}</td></tr>`;
				}

				// Scoreboard
				let sbRows = '';
				if (sb?.scores) {
					for (const [type, horizons] of Object.entries(sb.scores) as any) {
						const c = horizons['4'] || horizons['1'];
						if (!c || c.n === 0) continue;
						const avg = c.sumRet / c.n;
						const verdict = c.n < 20 ? '⏳ Veri birikiyor' : avg >= 0.15 ? '✅ Sinyal adayı' : avg <= -0.15 ? '🔄 Ters sinyal' : '❌ Gürültü';
						const vc = c.n < 20 ? '#888' : avg >= 0.15 ? '#10b981' : avg <= -0.15 ? '#f59e0b' : '#ef4444';
						sbRows += `<tr><td style="font-weight:600">${type}</td><td style="text-align:center">${pct(avg)}</td><td style="text-align:center">${((c.pos/c.n)*100).toFixed(0)}%</td><td style="text-align:center">${c.n}</td><td style="color:${vc};font-weight:600">${verdict}</td></tr>`;
					}
				}

				const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<title>KriptoQuant Rapor — ${now}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI',sans-serif;color:#1a1a2e;padding:40px;max-width:1100px;margin:0 auto}
h1{font-size:28px;margin-bottom:4px}
.sub{color:#666;font-size:14px;margin-bottom:32px}
h2{font-size:18px;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e4ef;color:#6366f1}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px}
th{text-align:left;padding:8px 10px;background:#f5f5fa;color:#5a5a7a;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e4ef}
td{padding:7px 10px;border-bottom:1px solid #eee}
tr:hover{background:#f8f8ff}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
.sb{text-align:center;padding:20px;border-radius:12px;background:#f5f5fa;border:1px solid #e2e4ef}
.sb .v{font-size:28px;font-weight:800}
.sb .l{font-size:11px;color:#888;text-transform:uppercase;margin-top:4px}
.ft{text-align:center;color:#aaa;font-size:12px;margin-top:40px;padding-top:16px;border-top:1px solid #eee}
.pb{display:inline-block;padding:8px 24px;background:#6366f1;color:#fff;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;margin-bottom:24px}
.pb:hover{background:#4f46e5}
@media print{.no-print{display:none!important}tr{page-break-inside:avoid}}
</style></head><body>
<button class="pb no-print" onclick="window.print()">🖨️ PDF Olarak Kaydet</button>
<h1>🧬 KriptoQuant — Durum Raporu</h1>
<p class="sub">${now} • Otonom Yanlışlama Motoru</p>
<div class="stats">
<div class="sb"><div class="v">${assumptions.length}</div><div class="l">Varsayım</div></div>
<div class="sb"><div class="v" style="color:${totalPnl>=0?'#10b981':'#ef4444'}">${pct(totalPnl)}</div><div class="l">Net PnL</div></div>
<div class="sb"><div class="v">${allClosed.length}</div><div class="l">Kapanan İşlem</div></div>
<div class="sb"><div class="v">${allClosed.length?((wins/allClosed.length)*100).toFixed(0):0}%</div><div class="l">Kazanma Oranı</div></div>
</div>
<h2>🎯 Varsayımlar</h2>
<table><thead><tr><th>Durum</th><th>Varsayım</th><th>Kanıt</th><th>Sonuç</th></tr></thead><tbody>${assumptionRows}</tbody></table>
<h2>🧪 Deneyler</h2>
<table><thead><tr><th>Deney</th><th>Yön</th><th>İşlem</th><th>Win%</th><th>PnL</th><th>Açık</th></tr></thead><tbody>${expRows}</tbody></table>
<h2>💹 Kapanan İşlemler (son 100)</h2>
<table><thead><tr><th>Coin</th><th>Yön</th><th>Giriş</th><th>Çıkış</th><th>PnL</th><th>Sebep</th><th>Deney</th><th>Tarih</th></tr></thead><tbody>${tradeRows||'<tr><td colspan="8" style="text-align:center;color:#aaa">Henüz yok</td></tr>'}</tbody></table>
${sbRows ? `<h2>📊 Gözlem Karnesi</h2><table><thead><tr><th>Tip</th><th>Ort.Getiri</th><th>Pozitif%</th><th>n</th><th>Değerlendirme</th></tr></thead><tbody>${sbRows}</tbody></table>` : ''}
<div class="ft">KriptoQuant — Otonom Yanlışlama Motoru • ${now}</div>
</body></html>`;

				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(html);
				return;
			} catch (e) {
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
