// ============================================================================
// EVOLVER KAPALIYKEN TEMİZLİK
// ============================================================================
// Evolver kapalıyken (varsayılan) onun ürettiği [KANIT]/[CROSS] deneyleri
// başlangıçta yedeklenip kaldırılmalı; kullanıcının deneyleri ve kontroller
// işlemleriyle birlikte kalmalı.
// ============================================================================

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { rmSync, existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExperimentRunner, createDefaultExperiments, isEvolvedExperiment } from '../src/organism/experiment-runner.js';
import { KnowledgeGraph } from '../src/organism/knowledge-graph.js';

const dir = process.env.ORGANISM_DATA_DIR!;

beforeEach(() => {
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
});
afterAll(() => {
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('Evolver kapalı', () => {
	it('otomatik deneyleri yedekleyip kaldırmalı, kullanıcının deneylerini korumalı', () => {
		const own = createDefaultExperiments();
		own[0].closedPositions.push({ id: 'keep', coin: 'BTCUSDT' } as any);
		const evolved = ['[KANIT] divergence → SHORT 4sa', '[CROSS] a × b'].map((name, i) => ({
			...createDefaultExperiments()[0],
			id: `evo-${i}`,
			name,
		}));
		writeFileSync(join(dir, 'experiments.json'), JSON.stringify([...own, ...evolved]));

		const runner = new ExperimentRunner(new KnowledgeGraph());
		const names = runner.getExperiments().map((e) => e.name);

		expect(names.some(isEvolvedExperiment), 'otomatik deney kaldı').toBe(false);
		expect(names.length).toBe(own.length);
		expect(runner.getExperiments().find((e) => e.id === own[0].id)?.closedPositions.length).toBe(1);

		const backup = readdirSync(dir).find((f) => f.startsWith('evolver-deneyleri-yedek-'));
		expect(backup, 'yedek yazılmadı').toBeDefined();
		expect(JSON.parse(readFileSync(join(dir, backup!), 'utf-8')).length).toBe(2);
	});
});
