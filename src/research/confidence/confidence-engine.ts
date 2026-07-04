// ============================================================================
// KRIPTOQUANT — Confidence Engine
// ============================================================================
// Stratejiden bağımsız güven puanlama motoru. Config-driven.
// Pipeline: Strategy → Filter Engine → [Confidence Engine] → Risk → Execution
// Saf fonksiyon — yan etkisi yok, aynı girdiye aynı çıktı.
// ============================================================================

import type { ConfidenceConfig } from '../../core/types.js';

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface ConfidenceVerdict {
	readonly score: number;
	readonly confidence: number;
	readonly passed: boolean;
	readonly breakdown: string;
}

// ─── Ana Fonksiyon ───────────────────────────────────────────────────────────

/**
 * Bir sinyalin güven puanını hesaplar. Config'den gelen eşikleri kullanır.
 */
export function calculateConfidence(
	adxValue: number,
	rvolValue: number,
	config: ConfidenceConfig,
): ConfidenceVerdict {
	let score = config.baseScore;
	const parts: string[] = [`Base: ${config.baseScore}`];

	if (adxValue > config.adxStrongThreshold) {
		score += config.adxStrongBonus;
		parts.push(`ADX(${adxValue.toFixed(1)})>${config.adxStrongThreshold}: +${config.adxStrongBonus}`);
	} else {
		parts.push(`ADX(${adxValue.toFixed(1)}): +0`);
	}

	if (rvolValue > config.rvolHighThreshold) {
		score += config.rvolHighBonus;
		parts.push(`RVOL(${rvolValue.toFixed(2)})>${config.rvolHighThreshold}: +${config.rvolHighBonus}`);
	} else {
		parts.push(`RVOL(${rvolValue.toFixed(2)}): +0`);
	}

	return {
		score,
		confidence: score / 100,
		passed: score >= config.minimumScore,
		breakdown: `[${parts.join(', ')} → Score: ${score}/100]`,
	};
}
