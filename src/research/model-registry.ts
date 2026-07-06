// ============================================================================
// KRIPTOQUANT — Model Registry & Governance (Sprint 32)
// ============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type ModelStatus = 'RESEARCH' | 'CANDIDATE' | 'LIVE';

export interface RegisteredModel {
	modelId: string;
	name: string;
	version: string;
	status: ModelStatus;
	oosSharpe: number;
	maxDrawdown: number;
	calibrationError: number;
	createdAt: string;
}

export class ModelRegistry {
	private filePath: string;

	constructor() {
		this.filePath = join(process.cwd(), 'results', 'model_registry.json');
	}

	public registerModel(model: Omit<RegisteredModel, 'modelId' | 'createdAt'>): RegisteredModel {
		const models = this.getModels();
		
		const newModel: RegisteredModel = {
			modelId: 'MDL-' + (models.length + 101),
			createdAt: new Date().toISOString(),
			...model
		};

		models.push(newModel);
		this.saveModels(models);
		return newModel;
	}

	public updateModelStatus(modelId: string, status: ModelStatus): boolean {
		const models = this.getModels();
		const idx = models.findIndex(m => m.modelId === modelId);
		if (idx === -1) return false;

		models[idx].status = status;
		this.saveModels(models);
		return true;
	}

	public getActiveLiveModels(): RegisteredModel[] {
		return this.getModels().filter(m => m.status === 'LIVE');
	}

	public getModels(): RegisteredModel[] {
		if (!existsSync(this.filePath)) {
			// Populate initial historical models to demonstrate Model Governance transitions
			const defaults: RegisteredModel[] = [
				{
					modelId: 'MDL-101',
					name: 'logistic-reg-btc',
					version: 'v1.0.0',
					status: 'LIVE',
					oosSharpe: 1.45,
					maxDrawdown: 0.082,
					calibrationError: 0.042,
					createdAt: '2026-07-01T12:00:00.000Z'
				},
				{
					modelId: 'MDL-102',
					name: 'xgboost-screener-sol',
					version: 'v1.1.0',
					status: 'CANDIDATE',
					oosSharpe: 1.88,
					maxDrawdown: 0.114,
					calibrationError: 0.058,
					createdAt: '2026-07-03T15:30:00.000Z'
				},
				{
					modelId: 'MDL-103',
					name: 'random-forest-regime',
					version: 'v0.9.0',
					status: 'RESEARCH',
					oosSharpe: 0.95,
					maxDrawdown: 0.155,
					calibrationError: 0.085,
					createdAt: '2026-07-05T18:00:00.000Z'
				}
			];
			try {
				const dir = join(process.cwd(), 'results');
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				writeFileSync(this.filePath, JSON.stringify(defaults, null, 4));
				return defaults;
			} catch {
				return [];
			}
		}

		try {
			const raw = readFileSync(this.filePath, 'utf-8');
			return JSON.parse(raw) as RegisteredModel[];
		} catch {
			return [];
		}
	}

	private saveModels(models: RegisteredModel[]): void {
		try {
			const dir = join(process.cwd(), 'results');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(this.filePath, JSON.stringify(models, null, 4));
		} catch {}
	}
}
