// ============================================================================
// ORGANISM — Research Journal
// ============================================================================
// Not a PnL report. A research diary.
// "Today 3 assumptions survived. 1 was wounded. The market taught us
//  that coins are NOT independent — correlation was 0.87."
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Assumption, JournalEntry } from './types.js';
import type { KnowledgeGraph } from './knowledge-graph.js';

const JOURNAL_DIR = join(process.cwd(), 'organism-data', 'journal');

export class ResearchJournal {
	constructor(private graph: KnowledgeGraph) {}

	/** Generate today's journal entry */
	generateEntry(assumptions: Assumption[]): JournalEntry {
		const now = new Date();
		const date = now.toISOString().slice(0, 10);
		const week = `${now.getFullYear()}-W${String(Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7)).padStart(2, '0')}`;

		const active = assumptions.find(a => a.status === 'testing');
		const recentObs = this.graph.getRecentObservations(24);

		// Collect surprises from recent observations
		const surprises = recentObs
			.filter(n => n.metadata.observationType === 'surprise' || n.metadata.observationType === 'isolation')
			.map(n => n.content);

		// Collect insights
		const allQuestions = this.graph.getAllQuestions();
		const recentQuestions = allQuestions
			.filter(q => q.timestamp > Date.now() - 24 * 60 * 60 * 1000)
			.map(q => q.content);

		// Count evidence
		let evidenceFor = 0, evidenceAgainst = 0;
		if (active) {
			for (const e of active.evidence) {
				if (e.timestamp > Date.now() - 24 * 60 * 60 * 1000) {
					if (e.supports) evidenceFor++;
					else evidenceAgainst++;
				}
			}
		}

		// Build narrative
		const notes = this.buildNarrative(assumptions, recentObs.length, surprises);

		const entry: JournalEntry = {
			date,
			week,
			activeAssumption: active?.statement ?? 'none',
			observationCount: recentObs.length,
			evidenceFor,
			evidenceAgainst,
			surprises: surprises.slice(0, 5),
			insights: [],
			newQuestions: recentQuestions.slice(0, 5),
			rawNotes: notes,
		};

		this.saveEntry(entry);
		return entry;
	}

	private buildNarrative(assumptions: Assumption[], obsCount: number, surprises: string[]): string {
		const lines: string[] = [];
		const now = new Date();

		lines.push(`# Araştırma Günlüğü — ${now.toISOString().slice(0, 10)}`);
		lines.push('');

		// Active assumption
		const active = assumptions.find(a => a.status === 'testing');
		if (active) {
			const forCount = active.evidence.filter(e => e.supports).length;
			const againstCount = active.evidence.filter(e => !e.supports).length;
			lines.push(`## Test Edilen Varsayım`);
			lines.push(`> "${active.statement}"`);
			lines.push(`Kanıt durumu: ${forCount} destekliyor, ${againstCount} çürütüyor.`);
			lines.push('');
		}

		// Summary
		lines.push(`## Özet`);
		lines.push(`- Son 24 saatte ${obsCount} gözlem yapıldı.`);

		const alive = assumptions.filter(a => a.status === 'alive').length;
		const killed = assumptions.filter(a => a.status === 'killed').length;
		const testing = assumptions.filter(a => a.status === 'testing').length;
		lines.push(`- Varsayımlar: ${alive} hayatta, ${killed} öldü, ${testing} test altında.`);
		lines.push('');

		// Surprises
		if (surprises.length > 0) {
			lines.push(`## Sürprizler`);
			for (const s of surprises.slice(0, 3)) {
				lines.push(`- ${s}`);
			}
			lines.push('');
		}

		// Assumption status table
		lines.push(`## Varsayım Durumları`);
		lines.push('| Varsayım | Durum | Kanıt (+/-) |');
		lines.push('|----------|-------|-------------|');
		for (const a of assumptions) {
			const f = a.evidence.filter(e => e.supports).length;
			const ag = a.evidence.filter(e => !e.supports).length;
			const statusEmoji = a.status === 'killed' ? '💀' : a.status === 'testing' ? '🔬' : a.status === 'alive' ? '🟢' : '⏳';
			lines.push(`| ${a.statement} | ${statusEmoji} ${a.status} | ${f}/${ag} |`);
		}
		lines.push('');

		return lines.join('\n');
	}

	private saveEntry(entry: JournalEntry): void {
		if (!existsSync(JOURNAL_DIR)) mkdirSync(JOURNAL_DIR, { recursive: true });
		const filename = `${entry.date}.json`;
		writeFileSync(join(JOURNAL_DIR, filename), JSON.stringify(entry, null, 2));

		// Also save as readable markdown
		const mdFilename = `${entry.date}.md`;
		writeFileSync(join(JOURNAL_DIR, mdFilename), entry.rawNotes);
	}

	/** Get all journal entries, sorted by date */
	getEntries(): JournalEntry[] {
		if (!existsSync(JOURNAL_DIR)) return [];
		return readdirSync(JOURNAL_DIR)
			.filter(f => f.endsWith('.json'))
			.sort()
			.map(f => {
				try {
					return JSON.parse(readFileSync(join(JOURNAL_DIR, f), 'utf-8')) as JournalEntry;
				} catch {
					return null;
				}
			})
			.filter((e): e is JournalEntry => e !== null);
	}
}
