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

export class KnowledgeGraph {
	private nodes: Map<string, KnowledgeNode> = new Map();
	private edges: KnowledgeEdge[] = [];

	constructor() {
		this.load();
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

	private save(): void {
		if (!existsSync(GRAPH_DIR)) mkdirSync(GRAPH_DIR, { recursive: true });
		const data: GraphData = {
			nodes: [...this.nodes.values()],
			edges: this.edges,
		};
		writeFileSync(GRAPH_FILE, JSON.stringify(data, null, 2));
	}
}
