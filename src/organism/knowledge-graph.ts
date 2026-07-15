// ============================================================================
// ORGANISM — Knowledge Graph
// ============================================================================
// Not a memory. A web of RELATIONSHIPS between observations, assumptions,
// insights, and questions. Over time, patterns emerge that no single
// observation could reveal.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeNode, KnowledgeEdge, Observation, Evidence } from './types.js';
import { randomUUID } from 'node:crypto';

const GRAPH_DIR = join(process.cwd(), 'organism-data');
const GRAPH_FILE = join(GRAPH_DIR, 'knowledge-graph.json');

interface GraphData {
	nodes: KnowledgeNode[];
	edges: KnowledgeEdge[];
}

const MAX_OBSERVATION_NODES = 2000; // grafik sınırsız büyümesin
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000; // aynı içerik 2 saat içinde tek sayılır

export class KnowledgeGraph {
	private nodes: Map<string, KnowledgeNode> = new Map();
	private edges: KnowledgeEdge[] = [];
	private saveTimer: NodeJS.Timeout | null = null;

	constructor() {
		this.load();
		this.cleanupOnLoad();
	}

	/**
	 * Açılışta bir kez: eski gözlemci-spam döneminden kalan mükerrer gözlemleri
	 * temizler (aynı içerik, 2 saatlik pencerede → ilki kalır) ve gözlem sayısını
	 * tavanla sınırlar. İç görüler ve sorular asla silinmez.
	 */
	private cleanupOnLoad(): void {
		const observations = [...this.nodes.values()]
			.filter((n) => n.type === 'observation')
			.sort((a, b) => a.timestamp - b.timestamp);

		const toDelete = new Set<string>();
		const lastSeen = new Map<string, number>();

		for (const n of observations) {
			const kept = lastSeen.get(n.content);
			if (kept !== undefined && n.timestamp - kept < DEDUP_WINDOW_MS) {
				toDelete.add(n.id);
			} else {
				lastSeen.set(n.content, n.timestamp);
			}
		}

		// Tavan: dedup sonrası hâlâ fazlaysa en eskiler düşer
		const surviving = observations.filter((n) => !toDelete.has(n.id));
		if (surviving.length > MAX_OBSERVATION_NODES) {
			for (const n of surviving.slice(0, surviving.length - MAX_OBSERVATION_NODES)) {
				toDelete.add(n.id);
			}
		}

		if (toDelete.size === 0) return;

		for (const id of toDelete) this.nodes.delete(id);
		this.edges = this.edges.filter((e) => !toDelete.has(e.from) && !toDelete.has(e.to));
		this.flush();
		console.log(`[KnowledgeGraph] 🧹 ${toDelete.size} mükerrer/eski gözlem düğümü temizlendi.`);
	}

	// ─── Add ──────────────────────────────────────────────────────────────

	addObservation(obs: Observation): string {
		const node: KnowledgeNode = {
			id: obs.id,
			type: 'observation',
			content: obs.description,
			timestamp: obs.timestamp,
			connections: [],
			metadata: { observationType: obs.type, coins: obs.coins, confidence: obs.confidence, ...obs.relatedData },
		};
		this.nodes.set(node.id, node);
		this.save();
		return node.id;
	}

	addInsight(content: string, relatedIds: string[]): string {
		const id = randomUUID();
		const node: KnowledgeNode = {
			id,
			type: 'insight',
			content,
			timestamp: Date.now(),
			connections: relatedIds,
			metadata: {},
		};
		this.nodes.set(id, node);

		for (const relId of relatedIds) {
			this.edges.push({
				from: relId,
				to: id,
				relation: 'led_to',
				timestamp: Date.now(),
			});
		}

		this.save();
		return id;
	}

	addQuestion(content: string, triggeredBy: string[]): string {
		const id = randomUUID();
		const node: KnowledgeNode = {
			id,
			type: 'question',
			content,
			timestamp: Date.now(),
			connections: triggeredBy,
			metadata: {},
		};
		this.nodes.set(id, node);

		for (const relId of triggeredBy) {
			this.edges.push({
				from: relId,
				to: id,
				relation: 'raised_question',
				timestamp: Date.now(),
			});
		}

		this.save();
		return id;
	}

	connect(fromId: string, toId: string, relation: KnowledgeEdge['relation']): void {
		this.edges.push({ from: fromId, to: toId, relation, timestamp: Date.now() });
		this.save();
	}

	// ─── Query ────────────────────────────────────────────────────────────

	getNode(id: string): KnowledgeNode | undefined {
		return this.nodes.get(id);
	}

	getConnections(id: string): KnowledgeNode[] {
		const connected: KnowledgeNode[] = [];
		for (const edge of this.edges) {
			if (edge.from === id) {
				const node = this.nodes.get(edge.to);
				if (node) connected.push(node);
			}
			if (edge.to === id) {
				const node = this.nodes.get(edge.from);
				if (node) connected.push(node);
			}
		}
		return connected;
	}

	getObservationsByType(type: string, since?: number): KnowledgeNode[] {
		const results: KnowledgeNode[] = [];
		for (const node of this.nodes.values()) {
			if (node.type === 'observation' && node.metadata.observationType === type) {
				if (!since || node.timestamp >= since) results.push(node);
			}
		}
		return results;
	}

	getAllQuestions(): KnowledgeNode[] {
		return [...this.nodes.values()].filter(n => n.type === 'question');
	}

	getRecentObservations(hours: number = 24): KnowledgeNode[] {
		const since = Date.now() - hours * 60 * 60 * 1000;
		return [...this.nodes.values()]
			.filter(n => n.type === 'observation' && n.timestamp >= since)
			.sort((a, b) => b.timestamp - a.timestamp);
	}

	// ─── Stats ────────────────────────────────────────────────────────────

	stats(): { nodes: number; edges: number; observations: number; insights: number; questions: number } {
		let observations = 0, insights = 0, questions = 0;
		for (const node of this.nodes.values()) {
			if (node.type === 'observation') observations++;
			if (node.type === 'insight') insights++;
			if (node.type === 'question') questions++;
		}
		return { nodes: this.nodes.size, edges: this.edges.length, observations, insights, questions };
	}

	// ─── Persistence ──────────────────────────────────────────────────────

	private load(): void {
		if (!existsSync(GRAPH_FILE)) return;
		try {
			const data: GraphData = JSON.parse(readFileSync(GRAPH_FILE, 'utf-8'));
			for (const node of data.nodes) this.nodes.set(node.id, node);
			this.edges = data.edges;
		} catch {
			// Start fresh if corrupted
		}
	}

	/**
	 * Yazmayı 5 sn'lik pencereyle toparlar — her gözlemde tüm grafiği senkron
	 * yazmak, dosya büyüdükçe event loop'u boğar.
	 */
	private save(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.flush();
		}, 5000);
		if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
	}

	private flush(): void {
		if (!existsSync(GRAPH_DIR)) mkdirSync(GRAPH_DIR, { recursive: true });
		const data: GraphData = {
			nodes: [...this.nodes.values()],
			edges: this.edges,
		};
		writeFileSync(GRAPH_FILE, JSON.stringify(data, null, 2));
	}
}
