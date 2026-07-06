import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRegistry } from '../../src/research/model-registry.js';

describe('ModelRegistry Unit Tests', () => {
	let registry: ModelRegistry;

	beforeEach(() => {
		registry = new ModelRegistry();
	});

	it('should successfully load default governance models', () => {
		const models = registry.getModels();
		expect(models.length).toBeGreaterThanOrEqual(3);
		
		const first = models[0];
		expect(first.modelId).toBeDefined();
		expect(first.status).toBeDefined();
	});

	it('should update model governance statuses correctly', () => {
		const success = registry.updateModelStatus('MDL-101', 'CANDIDATE');
		expect(success).toBe(true);

		const models = registry.getModels();
		const updated = models.find(m => m.modelId === 'MDL-101');
		expect(updated?.status).toBe('CANDIDATE');

		// Restore state
		registry.updateModelStatus('MDL-101', 'LIVE');
	});
});
