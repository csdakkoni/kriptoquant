// ============================================================================
// KRIPTOQUANT — Hierarchical Risk Parity (HRP) Portfolio Optimizer (Sprint 33)
// ============================================================================

export interface HrpAllocationResult {
	coin: string;
	weight: number; // Allocation percentage (0.0 - 1.0)
}

export class HrpOptimizer {
	/**
	 * Hiyerarşik Kümeleme (Hierarchical Clustering) ve Recursive Bisection ile HRP ağırlıklarını hesaplar.
	 * 
	 * @param coins - Portföydeki varlıkların listesi
	 * @param correlationMatrix - Korelasyon matrisi
	 * @param volatilities - Varlıkların ATR/Fiyat volatilite katsayıları
	 */
	public calculateHrpWeights(
		coins: string[],
		correlationMatrix: number[][],
		volatilities: number[]
	): HrpAllocationResult[] {
		const numAssets = coins.length;
		if (numAssets === 0) return [];
		if (numAssets === 1) return [{ coin: coins[0], weight: 1.0 }];

		// 1) Compute inverse-variance weights as baseline
		const invVars = volatilities.map(v => 1.0 / (v * v || 1e-4));
		const sumInvVars = invVars.reduce((a, b) => a + b, 0);
		const baseWeights = invVars.map(w => w / sumInvVars);

		// 2) Cluster distance calculation: d_i,j = sqrt( (1 - rho_i,j) / 2 )
		const distances: number[][] = Array.from({ length: numAssets }, () => Array(numAssets).fill(0));
		for (let i = 0; i < numAssets; i++) {
			for (let j = 0; j < numAssets; j++) {
				const rho = correlationMatrix[i]?.[j] ?? 0;
				distances[i][j] = Math.sqrt(Math.max(0, (1 - rho) / 2));
			}
		}

		// 3) Hierarchical Bisection (Simulate HRP tree bisection)
		// We recursively split the portfolio in two halves: left and right
		// Weight allocation is split according to cluster variances
		const weights = Array(numAssets).fill(1.0);
		this.recursiveBisection(0, numAssets - 1, baseWeights, correlationMatrix, weights);

		// Normalize weights to sum up to 1.0
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		
		return coins.map((coin, idx) => ({
			coin,
			weight: parseFloat((weights[idx] / (totalWeight || 1)).toFixed(4))
		}));
	}

	private recursiveBisection(
		start: number,
		end: number,
		baseWeights: number[],
		corr: number[][],
		weights: number[]
	): void {
		if (start >= end) return;

		// Find midpoint to bisect
		const mid = Math.floor((start + end) / 2);

		// Calculate variances for left cluster and right cluster
		const varLeft = this.getClusterVariance(start, mid, baseWeights, corr);
		const varRight = this.getClusterVariance(mid + 1, end, baseWeights, corr);

		// Allocate weights based on variance ratio: alpha = 1 - (varLeft / (varLeft + varRight))
		const totalVar = varLeft + varRight;
		const alpha = totalVar > 0 ? 1.0 - (varLeft / totalVar) : 0.5;

		// Scale cluster weights
		for (let i = start; i <= mid; i++) {
			weights[i] *= alpha;
		}
		for (let i = mid + 1; i <= end; i++) {
			weights[i] *= (1.0 - alpha);
		}

		// Bisect left and right sub-clusters
		this.recursiveBisection(start, mid, baseWeights, corr, weights);
		this.recursiveBisection(mid + 1, end, baseWeights, corr, weights);
	}

	private getClusterVariance(
		start: number,
		end: number,
		baseWeights: number[],
		corr: number[][]
	): number {
		let totalVar = 0;
		// Simplified quadratic form representation for cluster variance (w^T * V * w)
		for (let i = start; i <= end; i++) {
			for (let j = start; j <= end; j++) {
				const wI = baseWeights[i] ?? 0;
				const wJ = baseWeights[j] ?? 0;
				const c = corr[i]?.[j] ?? 0;
				totalVar += wI * wJ * c;
			}
		}
		return Math.max(1e-6, totalVar);
	}
}
