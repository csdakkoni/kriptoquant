// ============================================================================
// KRIPTOQUANT — Durum Raporu
// Kullanım (sunucuda): node scripts/rapor.js
// organism-data/ içindeki tüm state dosyalarını okuyup tek ekranlık,
// yorumlanabilir bir özet basar.
// ============================================================================

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'organism-data');
const readJson = (f) => {
	const p = join(DIR, f);
	if (!existsSync(p)) return null;
	try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
};
const age = (f) => {
	const p = join(DIR, f);
	if (!existsSync(p)) return null;
	return Math.round((Date.now() - statSync(p).mtimeMs) / 60000); // dk
};
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║           KRIPTOQUANT — DURUM RAPORU                   ║');
console.log(`║           ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }).padEnd(45)}║`);
console.log('╚════════════════════════════════════════════════════════╝');

// ─── Canlılık kontrolü ──────────────────────────────────────────────────────
const kgAge = age('knowledge-graph.json');
const expAge = age('experiments.json');
console.log('\n🫀 CANLILIK');
if (kgAge === null) {
	console.log('  ⚠️  knowledge-graph.json YOK — organizma hiç çalışmamış olabilir!');
} else {
	const healthy = Math.min(kgAge ?? 999, expAge ?? 999) <= 30;
	console.log(`  Bilgi grafiği son yazım : ${kgAge} dk önce ${kgAge <= 30 ? '✅' : '⚠️  (30dk+ — organizma duruyor olabilir!)'}`);
	console.log(`  Deney dosyası son yazım : ${expAge} dk önce ${expAge <= 30 ? '✅' : '⚠️'}`);
}

// ─── Varsayımlar ────────────────────────────────────────────────────────────
const assumptions = readJson('assumptions-state.json') || [];
const byStatus = (s) => assumptions.filter((a) => a.status === s);
console.log('\n🎯 VARSAYIMLAR');
console.log(`  Toplam ${assumptions.length} | 🟢 ${byStatus('alive').length} hayatta | 💀 ${byStatus('killed').length} öldü | 🔬 ${byStatus('testing').length} test ediliyor`);
for (const a of assumptions) {
	const f = (a.evidence || []).filter((e) => e.supports).length;
	const g = (a.evidence || []).length - f;
	const icon = { alive: '🟢', killed: '💀', testing: '🔬', queued: '⏳' }[a.status] || '❓';
	console.log(`  ${icon} ${a.statement}  [+${f}/-${g}]`);
	if (a.verdict) console.log(`     └ ${a.verdict}`);
}

// ─── Deneyler ───────────────────────────────────────────────────────────────
const experiments = readJson('experiments.json') || [];
console.log('\n🧪 DENEYLER (PnL sırasına göre)');
const running = experiments.filter((e) => e.status === 'running');
const done = experiments.filter((e) => e.status !== 'running');
const sorted = [...running].sort((a, b) => (b.stats?.totalPnlPercent || 0) - (a.stats?.totalPnlPercent || 0));
for (const e of sorted) {
	const s = e.stats || {};
	const side = (e.side || 'long') === 'short' ? '🔻' : '🔺';
	const open = (e.positions || []).filter((p) => !p.exitPrice).length;
	const badge = e.promoted ? ' ⭐ADAY' : '';
	console.log(`  ${side} ${e.name}${badge}`);
	console.log(`     işlem: ${s.totalTrades || 0} | kazanma: %${(s.winRate || 0).toFixed(0)} | PnL: ${pct(s.totalPnlPercent || 0)} | açık: ${open}`);
}
if (done.length > 0) console.log(`  (${done.length} deney tamamlandı/öldü)`);

// Toplam işlem özeti
const allClosed = experiments.flatMap((e) => e.closedPositions || []);
const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
const closedToday = allClosed.filter((p) => (p.exitTime || 0) >= todayStart.getTime());
const wins = allClosed.filter((p) => (p.pnlPercent || 0) > 0).length;
console.log('\n💹 İŞLEM ÖZETİ');
console.log(`  Toplam kapanan: ${allClosed.length} | Kazanma: %${allClosed.length ? ((wins / allClosed.length) * 100).toFixed(0) : 0}`);
console.log(`  Bugün: ${closedToday.length} işlem, net ${pct(closedToday.reduce((s, p) => s + (p.pnlPercent || 0), 0))}`);
if (allClosed.length > 0) {
	const best = allClosed.reduce((a, b) => ((a.pnlPercent || 0) > (b.pnlPercent || 0) ? a : b));
	const worst = allClosed.reduce((a, b) => ((a.pnlPercent || 0) < (b.pnlPercent || 0) ? a : b));
	console.log(`  En iyi: ${best.coin} ${pct(best.pnlPercent || 0)} | En kötü: ${worst.coin} ${pct(worst.pnlPercent || 0)}`);
}

// ─── Gözlem Karnesi ─────────────────────────────────────────────────────────
const sb = readJson('observation-scoreboard.json');
console.log('\n📊 GÖZLEM KARNESİ (1s sonrası ort. getiri)');
if (!sb || !sb.scores || Object.keys(sb.scores).length === 0) {
	console.log('  Henüz skor yok (gözlemlerden 1 saat sonra dolmaya başlar)');
} else {
	for (const [type, horizons] of Object.entries(sb.scores)) {
		const c = horizons['4'];
		if (!c || c.n === 0) continue;
		const avg = c.sumRet / c.n;
		const verdict = c.n < 20 ? `⏳ veri birikiyor (${c.n})` : avg >= 0.15 ? '✅ SİNYAL ADAYI' : avg <= -0.15 ? '🔄 TERS SİNYAL ADAYI' : '❌ gürültü';
		console.log(`  ${type.padEnd(12)} ${pct(avg).padStart(7)} (%${((c.pos / c.n) * 100).toFixed(0)} pozitif, n=${c.n})  ${verdict}`);
	}
	console.log(`  Ölçüm bekleyen: ${(sb.pending || []).length}`);
}

// ─── Günlük ─────────────────────────────────────────────────────────────────
const journalDir = join(DIR, 'journal');
if (existsSync(journalDir)) {
	const files = readdirSync(journalDir).filter((f) => f.endsWith('.json')).sort();
	if (files.length > 0) {
		const latest = JSON.parse(readFileSync(join(journalDir, files[files.length - 1]), 'utf-8'));
		console.log('\n📔 SON GÜNLÜK');
		console.log(`  ${latest.date} | ${latest.observationCount} gözlem | kanıt +${latest.evidenceFor}/-${latest.evidenceAgainst}`);
		for (const s of (latest.surprises || []).slice(0, 3)) console.log(`  ⚡ ${s}`);
		for (const i of (latest.insights || []).slice(0, 3)) console.log(`  💡 ${i}`);
	}
}

console.log('\n──────────────────────────────────────────────────────────\n');
