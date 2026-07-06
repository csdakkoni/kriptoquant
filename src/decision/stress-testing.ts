// ============================================================================
// KRIPTOQUANT — Stress Testing & CVaR Engine (Sprint 30)
// ============================================================================

export interface StressScenarioResult {
	scenarioName: string;
	shockPercentage: number;
	expectedLossUsdt: number;
	impactSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export class StressTestingEngine {
	/**
	 * Verilen fiyat getirileri üzerinden %95 güven seviyesinde Expected Shortfall (CVaR) hesaplar.
	 * 
	 * @param returns - Varlığın/Portföyün günlük yüzde getirileri (örn: [0.01, -0.02, 0.03])
	 */
	public calculateCVaR95(returns: number[]): number {
		if (returns.length < 5) return 0.05; // Varsayılan fallback %5 risk

		// Getirileri artan sırada sırala (en kötü kayıplar en başta)
		const sorted = [...returns].sort((a, b) => a - b);
		
		// %95 güven düzeyi için en kötü %5'lik dilimi belirle
		const cutoffIndex = Math.max(1, Math.floor(sorted.length * 0.05));
		
		// En kötü dilimdeki getirilerin ortalaması (Expected Shortfall)
		const worseReturns = sorted.slice(0, cutoffIndex);
		const sum = worseReturns.reduce((acc, val) => acc + val, 0);
		
		// Kayıp değeri pozitif gösterim amacıyla mutlak değerle döndürülür
		const cvar = Math.abs(sum / worseReturns.length);
		
		return parseFloat(cvar.toFixed(4));
	}

	/**
	 * Portföy değeri ve tahsis oranlarına göre makro şok senaryolarını simüle eder.
	 */
	public runMacroStressTests(equity: number, riskAllocationPercent: number): StressScenarioResult[] {
		const riskCapital = equity * (riskAllocationPercent / 100);

		const scenarios = [
			{ name: 'Black Swan Event', shock: -0.20, severity: 'CRITICAL' },
			{ name: 'Liquidation Squeeze', shock: -0.12, severity: 'HIGH' },
			{ name: 'Rate Hike Shock', shock: -0.08, severity: 'MEDIUM' }
		];

		return scenarios.map(s => {
			const expectedLoss = Math.abs(riskCapital * s.shock);
			return {
				scenarioName: s.name,
				shockPercentage: s.shock * 100,
				expectedLossUsdt: parseFloat(expectedLoss.toFixed(2)),
				impactSeverity: s.severity as any
			};
		});
	}

	/**
	 * Eğer CVaR hedef limiti (%15 drawdown limitini) aşarsa portfolio bütçesini ölçekler.
	 */
	public applyCVaRShaving(allocations: { asset: string; percentage: number }[], cvar95: number): { asset: string; percentage: number }[] {
		const targetLimit = 0.15; // %15 target CVaR limit
		if (cvar95 <= targetLimit) return allocations;

		// Ölçeklendirme faktörü
		const scaleFactor = targetLimit / cvar95;

		return allocations.map(item => {
			if (item.asset === 'CASH') return item;
			return {
				...item,
				percentage: Math.max(2, Math.round(item.percentage * scaleFactor))
			};
		});
	}
}
