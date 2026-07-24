// ============================================================================
// KRIPTOQUANT — Detaylı Rapor Modülü
// ============================================================================
// organism-data/ içindeki state dosyalarını okuyup tek sayfalık, yazdırılabilir
// analiz raporu üretir. Sadece tablo basmaz — veriden otomatik BULGU çıkarır
// (yönetici özeti), kardeş deneyleri karşılaştırır, yön/coin/çıkış/saat
// kırılımlarını hesaplar.
// ============================================================================

interface Trade {
	coin?: string;
	side?: string;
	entryPrice?: number;
	exitPrice?: number;
	pnlPercent?: number;
	exitReason?: string;
	entryTime?: number;
	exitTime?: number;
	expName?: string;
	expSide?: string;
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const col = (v: number) => (v > 0 ? '#10b981' : v < 0 ? '#ef4444' : '#666');
const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

const EXIT_LABELS: Record<string, string> = {
	take_profit: 'Kâr Al',
	stop_loss: 'Zarar Kes',
	trailing_stop: 'İz Süren',
	fixed_exit: 'Süre Doldu',
	experiment_end: 'Deney Bitti',
};

const CONTROL_PREFIX = 'Random '; // saf kontrol grupları
const isControl = (name: string) => (name || '').startsWith(CONTROL_PREFIX);

// Karne ufukları — observation-scoreboard.ts'teki HORIZONS ile aynı sırada
const SB_HORIZONS: [string, string][] = [
	['4', '1 saat'],
	['16', '4 saat'],
	['48', '12 saat'],
	['96', '24 saat'],
	['192', '48 saat'],
];

/** Bir işlem kümesinin özet istatistikleri */
function summarize(trades: Trade[]) {
	const n = trades.length;
	const sum = trades.reduce((s, t) => s + (t.pnlPercent || 0), 0);
	const wins = trades.filter((t) => (t.pnlPercent || 0) > 0);
	const losses = trades.filter((t) => (t.pnlPercent || 0) <= 0);
	const grossWin = wins.reduce((s, t) => s + (t.pnlPercent || 0), 0);
	const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnlPercent || 0), 0));
	return {
		n,
		sum,
		avg: n ? sum / n : 0,
		winRate: n ? (wins.length / n) * 100 : 0,
		avgWin: wins.length ? grossWin / wins.length : 0,
		avgLoss: losses.length ? -grossLoss / losses.length : 0,
		profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
	};
}

/** Kümülatif PnL eğrisi — bağımlılıksız satır içi SVG */
function sparkline(trades: Trade[], width = 900, height = 120): string {
	const chrono = [...trades].sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));
	if (chrono.length < 2) return '<p style="color:#888;font-size:13px">Eğri için yeterli işlem yok.</p>';

	let cum = 0;
	const pts = chrono.map((t) => (cum += t.pnlPercent || 0));
	const min = Math.min(0, ...pts);
	const max = Math.max(0, ...pts);
	const range = max - min || 1;
	const x = (i: number) => (i / (pts.length - 1)) * (width - 60) + 45;
	const y = (v: number) => height - 20 - ((v - min) / range) * (height - 40);

	const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
	const last = pts[pts.length - 1];
	const stroke = col(last);

	return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;max-height:${height}px">
    <line x1="45" y1="${y(0).toFixed(1)}" x2="${width - 15}" y2="${y(0).toFixed(1)}" stroke="#ddd" stroke-width="1" stroke-dasharray="4 4"/>
    <path d="${area}" fill="${stroke}" opacity="0.08"/>
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
    <text x="8" y="${y(max).toFixed(1)}" font-size="10" fill="#888">${pct(max)}</text>
    <text x="8" y="${y(min).toFixed(1)}" font-size="10" fill="#888">${pct(min)}</text>
    <text x="${width - 12}" y="${y(last).toFixed(1) }" font-size="11" font-weight="700" fill="${stroke}" text-anchor="end">${pct(last)}</text>
  </svg>`;
}

/** Kırılım tablosu (yön / coin / çıkış sebebi / saat dilimi) */
function breakdownTable(title: string, groups: Map<string, Trade[]>, labelHeader: string): string {
	const rows = [...groups.entries()]
		.map(([key, ts]) => ({ key, ...summarize(ts) }))
		.filter((r) => r.n > 0)
		.sort((a, b) => b.sum - a.sum)
		.map(
			(r) =>
				`<tr><td style="font-weight:600">${esc(r.key)}</td><td style="text-align:center">${r.n}</td><td style="text-align:center">%${r.winRate.toFixed(0)}</td><td style="text-align:center">${pct(r.avg)}</td><td style="text-align:center;font-weight:700;color:${col(r.sum)}">${pct(r.sum)}</td></tr>`,
		)
		.join('');
	if (!rows) return '';
	return `<h3>${title}</h3><table><thead><tr><th>${labelHeader}</th><th style="text-align:center">İşlem</th><th style="text-align:center">Kazanma</th><th style="text-align:center">Ort. PnL</th><th style="text-align:center">Toplam</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function groupBy(trades: Trade[], keyFn: (t: Trade) => string | null): Map<string, Trade[]> {
	const m = new Map<string, Trade[]>();
	for (const t of trades) {
		const k = keyFn(t);
		if (!k) continue;
		if (!m.has(k)) m.set(k, []);
		m.get(k)!.push(t);
	}
	return m;
}

/**
 * Yönetici özeti — veriden otomatik bulgu cümleleri üretir.
 * Sistemin kendi sonuçlarını okuması; rapordaki en değerli bölüm.
 */
function buildInsights(ctx: {
	assumptions: any[];
	experiments: any[];
	trades: Trade[];
	sb: any;
	regime: any;
}): string[] {
	const out: string[] = [];
	const { assumptions, experiments, trades, sb, regime } = ctx;

	// 1) Rejim durumu
	if (regime?.state) {
		const labels: Record<string, string> = {
			BULL: '🐂 BOĞA — long motoru devrede',
			BEAR: '🐻 AYI — short motoru devrede',
			CHOP: '➡️ YATAY — nakitte bekleniyor (yeni pozisyon açılmıyor)',
			UNKNOWN: '❓ Rejim henüz belirlenmedi',
		};
		out.push(`Piyasa rejimi: <b>${labels[regime.state] || regime.state}</b> — BTC, 200-SMA'ya göre ${regime.distancePct >= 0 ? '+' : ''}${regime.distancePct}% konumda (±%${regime.bandPct ?? 2} bandı yatay sayılır).`);
	}

	// 2) Üç kardeş karşılaştırması — sistemin ana sorusu
	const find = (needle: string) => experiments.find((e) => (e.name || '').includes(needle));
	const rl = find('Random + Stop/Target');
	const rs = find('Random SHORT');
	const rr = find('Rejim Anahtarlı');
	if (rr?.stats?.totalTrades > 0) {
		const parts = [
			rl ? `saf LONG ${pct(rl.stats?.totalPnlPercent || 0)}` : null,
			rs ? `saf SHORT ${pct(rs.stats?.totalPnlPercent || 0)}` : null,
		].filter(Boolean).join(', ');
		const rrPnl = rr.stats.totalPnlPercent || 0;
		const beatsBoth =
			(!rl || rrPnl > (rl.stats?.totalPnlPercent || 0)) && (!rs || rrPnl > (rs.stats?.totalPnlPercent || 0));
		out.push(
			`Rejim anahtarı sınavı: anahtarlı random <b style="color:${col(rrPnl)}">${pct(rrPnl)}</b> (${rr.stats.totalTrades} işlem, %${(rr.stats.winRate || 0).toFixed(0)} kazanma)${parts ? ` — kıyas: ${parts}` : ''}. ${beatsBoth ? '✅ Şu an <b>iki saf yönü de geçiyor</b>; yön seçiminin değer kattığına dair ilk canlı kanıt.' : '⚠️ Henüz saf yönleri geçmiş değil.'} ${rr.stats.totalTrades < 30 ? '<i>(Örneklem küçük — 30+ işleme kadar sonuç şans olabilir.)</i>' : ''}`,
		);
	}

	// 3) Aday vs kontrol — SADECE ORTAK DÖNEMDE geçerlidir.
	// 24 Tem dersi: kontroller 18 Tem'de ölüp donmuştu, adaylar ise sonraki
	// düşüşte işlem yapmaya devam etti. İki grubu ham toplamla kıyaslamak
	// farklı piyasaları kıyaslamaktır ve yanlış verdikt üretir. Bu yüzden
	// kıyas, iki grubun da işlem yaptığı zaman aralığıyla sınırlandırılır.
	const candTrades = trades.filter((t) => !isControl(t.expName || ''));
	const ctrlTrades = trades.filter((t) => isControl(t.expName || ''));
	if (candTrades.length && ctrlTrades.length) {
		const times = (ts: Trade[]) => ts.map((t) => t.exitTime || 0).filter(Boolean);
		const cT = times(candTrades);
		const kT = times(ctrlTrades);
		const overlapStart = Math.max(Math.min(...cT), Math.min(...kT));
		const overlapEnd = Math.min(Math.max(...cT), Math.max(...kT));
		const inWindow = (t: Trade) => (t.exitTime || 0) >= overlapStart && (t.exitTime || 0) <= overlapEnd;
		const cw = summarize(candTrades.filter(inWindow));
		const kw = summarize(ctrlTrades.filter(inWindow));
		const staleHours = (Math.max(...cT) - Math.max(...kT)) / 3_600_000;

		if (cw.n >= 10 && kw.n >= 10) {
			const fmtDay = (ts: number) => new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
			out.push(
				`Adaylar vs kontrol <i>(ortak dönem: ${fmtDay(overlapStart)}–${fmtDay(overlapEnd)})</i>: adaylar ort. <b>${pct(cw.avg)}</b>/işlem (${cw.n} işlem), saf random kontroller ort. <b>${pct(kw.avg)}</b>/işlem (${kw.n} işlem). ${cw.avg > kw.avg ? '✅ Adaylar rastgeleyi geçiyor.' : '⚠️ Adaylar henüz rastgeleyi geçemedi.'}${staleHours > 24 ? ` <b>Not:</b> kontroller ${staleHours.toFixed(0)} saattir işlem açmıyor — ortak dönem dışındaki aday işlemleri bu kıyasa dahil edilmedi.` : ''}`,
			);
		} else {
			out.push(
				`⚠️ <b>Aday–kontrol kıyası şu an yapılamıyor:</b> iki grubun ortak işlem dönemi yetersiz (adaylar ${cw.n}, kontroller ${kw.n} işlem)${staleHours > 24 ? `; kontroller ${staleHours.toFixed(0)} saattir sessiz` : ''}. Kontroller yeniden işlem açtıkça kıyas otomatik geri gelir — o zamana kadar ham toplamları kıyaslamak farklı piyasa dönemlerini kıyaslamak olur.`,
			);
		}
	}

	// 4) Yön asimetrisi
	const longT = trades.filter((t) => (t.side || 'long') === 'long');
	const shortT = trades.filter((t) => t.side === 'short');
	if (longT.length >= 5 && shortT.length >= 5) {
		const l = summarize(longT);
		const s = summarize(shortT);
		out.push(
			`Yön asimetrisi: LONG ${pct(l.sum)} (${l.n} işlem, ort. ${pct(l.avg)}) — SHORT ${pct(s.sum)} (${s.n} işlem, ort. ${pct(s.avg)}). ${Math.abs(l.avg - s.avg) > 0.3 ? 'Fark belirgin: bu dönemde kazandıran şey <b>yön</b>, işçilik değil.' : 'İki yön birbirine yakın — piyasa yönsüz seyrediyor.'}`,
		);
	}

	// 5) Hayatta kalan varsayımlar ve UYARI: büyüklük ≠ yön
	const alive = assumptions.filter((a) => a.status === 'alive');
	const killed = assumptions.filter((a) => a.status === 'killed');
	if (alive.length || killed.length) {
		out.push(
			`Varsayım bilançosu: <b>${alive.length} hayatta</b>, <b>${killed.length} öldürüldü</b>, ${assumptions.filter((a) => a.status === 'testing').length} test ediliyor. Ölen her varsayım, bir daha o yöne emek harcanmayacağı anlamına gelir.`,
		);
	}
	const volAlive = alive.some((a) => /hacim/i.test(a.statement || ''));
	const volExp = experiments.find((e) => /Hacim Patlaması/i.test(e.name || ''));
	if (volAlive && volExp?.stats?.totalTrades > 0 && (volExp.stats.totalPnlPercent || 0) < 0) {
		out.push(
			`⚠️ <b>Kritik nüans:</b> "Hacim geleceği tahmin eder" varsayımı hayatta (istatistiksel olarak doğru) ama ondan doğan deney ${pct(volExp.stats.totalPnlPercent)} zararda. Sebep: hacim testi hareketin <b>büyüklüğünü</b> öngörüyor, <b>yönünü</b> değil. Volatilite tahmini tek başına para kazandırmaz — yön filtresiyle birleşmesi gerekir.`,
		);
	}

	// 6) Karne bulguları
	if (sb?.scores) {
		const mature = Object.entries(sb.scores as Record<string, any>)
			.map(([type, h]) => ({ type, c: h['4'] }))
			.filter((r) => r.c && r.c.n >= 20);
		const signals = mature.filter((r) => r.c.sumRet / r.c.n >= 0.15);
		const inverse = mature.filter((r) => r.c.sumRet / r.c.n <= -0.15);
		const noise = mature.filter((r) => Math.abs(r.c.sumRet / r.c.n) < 0.15);
		if (mature.length) {
			out.push(
				`Gözlem karnesi (n≥20): ${signals.length ? `sinyal adayı: <b>${signals.map((s) => s.type).join(', ')}</b>` : 'sinyal adayı yok'}${inverse.length ? `; ters sinyal: <b>${inverse.map((s) => s.type).join(', ')}</b>` : ''}${noise.length ? `; gürültü: ${noise.map((s) => s.type).join(', ')}` : ''}. Gürültü çıkan gözlemcilerin akıştaki mesajları işlem kararına girmemeli.`,
			);
		}
	}

	// 7) En iyi / en kötü deney
	const ranked = [...experiments]
		.filter((e) => (e.stats?.totalTrades || 0) >= 3)
		.sort((a, b) => (b.stats?.totalPnlPercent || 0) - (a.stats?.totalPnlPercent || 0));
	if (ranked.length >= 2) {
		const best = ranked[0];
		const worst = ranked[ranked.length - 1];
		out.push(
			`Sıralama: en iyi <b>${esc(best.name)}</b> ${pct(best.stats.totalPnlPercent)} — en kötü <b>${esc(worst.name)}</b> ${pct(worst.stats.totalPnlPercent)}. Terfi eşiği: 15+ işlem, %52+ kazanma, pozitif PnL.`,
		);
	}

	return out;
}

// ─── Ana rapor üreteci ──────────────────────────────────────────────────────

export function buildReportHtml(data: {
	assumptions: any[];
	experiments: any[];
	scoreboard: any;
	regime: any;
}): string {
	const { assumptions, experiments, scoreboard: sb, regime } = data;
	const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

	// Tüm kapanan işlemler (deney adı ve yönüyle zenginleştirilmiş)
	const trades: Trade[] = experiments.flatMap((e: any) =>
		(e.closedPositions || []).map((p: any) => ({ ...p, expName: e.name, expSide: e.side })),
	);
	trades.sort((a, b) => (b.exitTime || 0) - (a.exitTime || 0));

	const all = summarize(trades);
	const cand = summarize(trades.filter((t) => !isControl(t.expName || '')));
	const ctrl = summarize(trades.filter((t) => isControl(t.expName || '')));

	// Bugünkü işlemler
	const dayStart = new Date();
	dayStart.setHours(0, 0, 0, 0);
	const today = summarize(trades.filter((t) => (t.exitTime || 0) >= dayStart.getTime()));

	const insights = buildInsights({ assumptions, experiments, trades, sb, regime });

	// ── Varsayımlar (durum grupları halinde) ──
	const statusOrder = ['alive', 'killed', 'testing', 'queued'];
	const statusMeta: Record<string, { icon: string; label: string; color: string }> = {
		alive: { icon: '🟢', label: 'HAYATTA', color: '#10b981' },
		killed: { icon: '💀', label: 'ÖLDÜ', color: '#ef4444' },
		testing: { icon: '🔬', label: 'TEST EDİLİYOR', color: '#6366f1' },
		queued: { icon: '⏳', label: 'SIRADA', color: '#888' },
	};
	const assumptionRows = statusOrder
		.flatMap((st) => assumptions.filter((a) => a.status === st))
		.map((a) => {
			const f = (a.evidence || []).filter((e: any) => e.supports).length;
			const g = (a.evidence || []).length - f;
			const m = statusMeta[a.status] || { icon: '❓', label: a.status, color: '#888' };
			const ratio = f + g > 0 ? ((f / (f + g)) * 100).toFixed(0) : '—';
			return `<tr><td style="color:${m.color};font-weight:600;white-space:nowrap">${m.icon} ${m.label}</td><td>${esc(a.statement)}</td><td style="text-align:center">+${f} / -${g}</td><td style="text-align:center">%${ratio}</td><td style="font-size:11px;color:#666">${esc(a.verdict || '—')}</td></tr>`;
		})
		.join('');

	// ── Deneyler (çalışan + biten) ──
	const expRow = (e: any) => {
		const s = e.stats || {};
		const pnlVal = s.totalPnlPercent || 0;
		const sideBadge =
			e.side === 'regime' ? '🔀 REJİM' : e.side === 'short' ? '🔻 SHORT' : '🔺 LONG';
		const open = (e.positions || []).filter((p: any) => !p.exitPrice).length;
		const statusIcon = e.status === 'running' ? '▶️' : e.status === 'completed' ? '✅' : '💀';
		const tag = isControl(e.name) ? '<span style="font-size:10px;background:#eee;color:#666;padding:2px 6px;border-radius:4px;margin-left:6px">KONTROL</span>' : '';
		return `<tr><td>${statusIcon} ${esc(e.name)}${e.promoted ? ' ⭐' : ''}${tag}<div style="font-size:11px;color:#888;margin-top:2px">${esc(e.hypothesis || '')}</div></td><td style="text-align:center;white-space:nowrap">${sideBadge}</td><td style="text-align:center">${s.totalTrades || 0}</td><td style="text-align:center">%${(s.winRate || 0).toFixed(0)}</td><td style="text-align:center;font-weight:700;color:${col(pnlVal)}">${pct(pnlVal)}</td><td style="text-align:center">${open}</td></tr>`;
	};
	const runningRows = experiments.filter((e) => e.status === 'running').sort((a, b) => (b.stats?.totalPnlPercent || 0) - (a.stats?.totalPnlPercent || 0)).map(expRow).join('');
	const finishedRows = experiments.filter((e) => e.status !== 'running').sort((a, b) => (b.stats?.totalPnlPercent || 0) - (a.stats?.totalPnlPercent || 0)).map(expRow).join('');

	// ── Kırılımlar ──
	const dirTable = breakdownTable(
		'Yöne Göre',
		groupBy(trades, (t) => ((t.side || 'long') === 'short' ? '🔻 SHORT' : '🔺 LONG')),
		'Yön',
	);
	const coinTable = breakdownTable('Coin Bazında', groupBy(trades, (t) => (t.coin || '').replace('USDT', '')), 'Coin');
	const exitTable = breakdownTable(
		'Çıkış Sebebine Göre',
		groupBy(trades, (t) => EXIT_LABELS[t.exitReason || ''] || t.exitReason || '?'),
		'Çıkış',
	);
	const hourTable = breakdownTable(
		'Saat Dilimine Göre (giriş saati, UTC)',
		groupBy(trades, (t) => {
			if (!t.entryTime) return null;
			const h = new Date(t.entryTime).getUTCHours();
			const band = Math.floor(h / 6) * 6;
			return `${String(band).padStart(2, '0')}:00–${String(band + 6).padStart(2, '0')}:00`;
		}),
		'Dilim',
	);

	// ── Gözlem karnesi ──
	let sbRows = '';
	if (sb?.scores) {
		for (const [type, horizons] of Object.entries(sb.scores as Record<string, any>)) {
			const cells = SB_HORIZONS.map(([h]) => {
				const c = horizons[h];
				if (!c || !c.n) return '<td style="text-align:center;color:#bbb">—</td>';
				const avg = c.sumRet / c.n;
				return `<td style="text-align:center;color:${col(avg)}">${pct(avg)}<div style="font-size:10px;color:#999">%${((c.pos / c.n) * 100).toFixed(0)} poz · n=${c.n}</div></td>`;
			}).join('');
			const c1 = horizons['4'];
			const avg1 = c1 && c1.n ? c1.sumRet / c1.n : 0;
			const verdict = !c1 || c1.n < 20 ? ['⏳ Veri birikiyor', '#888'] : avg1 >= 0.15 ? ['✅ Sinyal adayı', '#10b981'] : avg1 <= -0.15 ? ['🔄 Ters sinyal', '#f59e0b'] : ['❌ Gürültü', '#ef4444'];
			sbRows += `<tr><td style="font-weight:600">${esc(type)}</td>${cells}<td style="color:${verdict[1]};font-weight:600">${verdict[0]}</td></tr>`;
		}
	}

	// ── İşlem listesi ──
	const tradeRows = trades.slice(0, 100).map((t) => {
		const pv = t.pnlPercent || 0;
		const fmtP = (p?: number) => (p == null ? '—' : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toFixed(4));
		return `<tr><td style="font-weight:600">${esc((t.coin || '').replace('USDT', ''))}</td><td style="text-align:center">${t.side === 'short' ? '🔻' : '🔺'}</td><td style="text-align:right">${fmtP(t.entryPrice)}</td><td style="text-align:right">${fmtP(t.exitPrice)}</td><td style="text-align:center;font-weight:600;color:${col(pv)}">${pct(pv)}</td><td>${esc(EXIT_LABELS[t.exitReason || ''] || t.exitReason || '?')}</td><td style="font-size:11px;color:#888">${esc(t.expName || '—')}</td><td style="font-size:11px;color:#888;white-space:nowrap">${t.exitTime ? new Date(t.exitTime).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td></tr>`;
	}).join('');

	const regimeMeta: Record<string, { label: string; color: string }> = {
		BULL: { label: '🐂 BOĞA', color: '#10b981' },
		BEAR: { label: '🐻 AYI', color: '#ef4444' },
		CHOP: { label: '➡️ YATAY', color: '#f59e0b' },
		UNKNOWN: { label: '❓ —', color: '#888' },
	};
	const rm = regimeMeta[regime?.state || 'UNKNOWN'];

	return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KriptoQuant Rapor — ${now}</title>
<style>
/* Rapor her zaman AÇIK temadır — tarayıcı koyu moddayken de okunur kalsın
   (arka plan tanımlanmazsa koyu modda koyu zemin + koyu metin = görünmez metin) */
:root{color-scheme:light}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#ffffff}
body{font-family:-apple-system,'Segoe UI',sans-serif;color:#1a1a2e;padding:36px 28px;max-width:1150px;margin:0 auto;line-height:1.5}
h1{font-size:26px;margin-bottom:2px}
.sub{color:#666;font-size:13px;margin-bottom:26px}
h2{font-size:17px;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #e2e4ef;color:#6366f1}
h3{font-size:13px;margin:18px 0 8px;color:#5a5a7a;text-transform:uppercase;letter-spacing:.5px}
table{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px}
th{text-align:left;padding:8px 10px;background:#f5f5fa;color:#5a5a7a;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e4ef}
td{padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top}
tr:hover{background:#fafaff}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:24px}
.sb{text-align:center;padding:16px 10px;border-radius:12px;background:#f7f7fc;border:1px solid #e6e6f2}
.sb .v{font-size:22px;font-weight:800;line-height:1.2}
.sb .l{font-size:10px;color:#888;text-transform:uppercase;margin-top:4px;letter-spacing:.3px}
.ins{background:#f7f9ff;border:1px solid #dfe4fb;border-left:4px solid #6366f1;border-radius:10px;padding:16px 18px;margin-bottom:24px}
.ins ul{margin:0;padding-left:18px}
.ins li{margin:7px 0;font-size:13.5px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.ft{text-align:center;color:#aaa;font-size:11px;margin-top:40px;padding-top:14px;border-top:1px solid #eee}
.pb{display:inline-block;padding:9px 22px;background:#6366f1;color:#fff;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;margin-bottom:22px}
.pb:hover{background:#4f46e5}
.note{font-size:11.5px;color:#888;margin:-8px 0 16px}
@media print{.no-print{display:none!important}tr{page-break-inside:avoid}h2{page-break-after:avoid}body{padding:0}}
@media(max-width:800px){.stats{grid-template-columns:repeat(3,1fr)}.grid2{grid-template-columns:1fr}}
</style></head><body>
<button class="pb no-print" onclick="window.print()">🖨️ PDF Olarak Kaydet</button>
<h1>🧬 KriptoQuant — Detaylı Durum Raporu</h1>
<p class="sub">${now} • Otonom Yanlışlama Motoru</p>

<div class="stats">
  <div class="sb"><div class="v" style="color:${rm.color};font-size:17px">${rm.label}</div><div class="l">Piyasa Rejimi</div></div>
  <div class="sb"><div class="v" style="color:${col(cand.sum)}">${pct(cand.sum)}</div><div class="l">Aday PnL (${cand.n})</div></div>
  <div class="sb"><div class="v" style="color:#999">${pct(ctrl.sum)}</div><div class="l">Kontrol PnL (${ctrl.n})</div></div>
  <div class="sb"><div class="v" style="color:${col(today.sum)}">${pct(today.sum)}</div><div class="l">Bugün (${today.n})</div></div>
  <div class="sb"><div class="v">${all.n}</div><div class="l">Kapanan İşlem</div></div>
  <div class="sb"><div class="v">%${all.winRate.toFixed(0)}</div><div class="l">Kazanma Oranı</div></div>
</div>

<h2>🧠 Yönetici Özeti — Verinin Söyledikleri</h2>
<div class="ins"><ul>${insights.map((i) => `<li>${i}</li>`).join('')}</ul></div>

<h2>📈 Kümülatif PnL Eğrisi (tüm deneyler, kronolojik)</h2>
${sparkline(trades)}
<p class="note">Not: Yüzdelerin kümülatif toplamıdır — kasa getirisi değil, deney havuzunun yönünü gösterir. Kontrol grupları da dahildir.</p>

<h2>🧪 Deneyler</h2>
<h3>Çalışanlar</h3>
<table><thead><tr><th>Deney</th><th style="text-align:center">Yön</th><th style="text-align:center">İşlem</th><th style="text-align:center">Kazanma</th><th style="text-align:center">PnL</th><th style="text-align:center">Açık</th></tr></thead><tbody>${runningRows || '<tr><td colspan="6" style="color:#888">Çalışan deney yok</td></tr>'}</tbody></table>
${finishedRows ? `<h3>Tamamlananlar / Öldürülenler</h3><table><thead><tr><th>Deney</th><th style="text-align:center">Yön</th><th style="text-align:center">İşlem</th><th style="text-align:center">Kazanma</th><th style="text-align:center">PnL</th><th style="text-align:center">Açık</th></tr></thead><tbody>${finishedRows}</tbody></table>` : ''}

<h2>🔍 Kırılım Analizleri</h2>
<div class="grid2">
  <div>${dirTable}${exitTable}</div>
  <div>${coinTable}${hourTable}</div>
</div>

<h2>🎯 Varsayımlar</h2>
<table><thead><tr><th>Durum</th><th>Varsayım</th><th style="text-align:center">Kanıt</th><th style="text-align:center">Destek</th><th>Sonuç</th></tr></thead><tbody>${assumptionRows}</tbody></table>

<h2>📊 Gözlem Karnesi</h2>
<table><thead><tr><th>Tip</th>${SB_HORIZONS.map(([, label]) => `<th style="text-align:center">${label} sonra</th>`).join('')}<th>Değerlendirme</th></tr></thead><tbody>${sbRows || `<tr><td colspan="${SB_HORIZONS.length + 2}" style="color:#888">Henüz skor yok</td></tr>`}</tbody></table>
<p class="note">Verdikt 1 saatlik ufka göre verilir ve en az 20 ölçüm gerektirir. Referans: %0.3 gidiş-dönüş işlem maliyeti.</p>

<h2>💹 Kapanan İşlemler (son 100)</h2>
<table><thead><tr><th>Coin</th><th style="text-align:center">Yön</th><th style="text-align:right">Giriş</th><th style="text-align:right">Çıkış</th><th style="text-align:center">Net PnL</th><th>Sebep</th><th>Deney</th><th>Tarih</th></tr></thead><tbody>${tradeRows || '<tr><td colspan="8" style="color:#888">Henüz kapanan işlem yok</td></tr>'}</tbody></table>
<p class="note">Tüm PnL değerleri %0.3 gidiş-dönüş işlem maliyeti düşülmüş nettir. İşlemler sanaldır (paper trading).</p>

<div class="ft">KriptoQuant — Otonom Yanlışlama Motoru • ${now} • Bu rapor otomatik üretilmiştir</div>
</body></html>`;
}
