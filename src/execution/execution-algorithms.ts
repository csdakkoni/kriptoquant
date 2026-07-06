// ============================================================================
// KRIPTOQUANT — Algorithmic Execution Schedules (TWAP & VWAP) (Sprint 34)
// ============================================================================

export interface ExecutionChunk {
	chunkIndex: number;
	size: number;
	participationRate?: number;
}

export class ExecutionAlgorithms {
	/**
	 * TWAP (Time Weighted Average Price) takvimi oluşturur.
	 * Market izlerini azaltmak için dilim büyüklüklerine rastgele gürültü ekler.
	 * 
	 * @param totalSize - Yürütülecek toplam emir büyüklüğü (adet cinsinden)
	 * @param numIntervals - Emrin bölünmek istendiği aralık sayısı (periyot, örn: 5)
	 * @param randomize - Sapma eklenip eklenmeyeceği bayrağı
	 */
	public generateTwapSchedule(totalSize: number, numIntervals: number = 5, randomize: boolean = true): ExecutionChunk[] {
		if (numIntervals <= 0) return [{ chunkIndex: 1, size: totalSize }];
		
		if (!randomize) {
			const chunkSize = totalSize / numIntervals;
			return Array.from({ length: numIntervals }, (_, i) => ({
				chunkIndex: i + 1,
				size: parseFloat(chunkSize.toFixed(6))
			}));
		}

		// Generate random weights that sum to 1.0 to add noise
		const rawWeights = Array.from({ length: numIntervals }, () => 0.85 + Math.random() * 0.30); // 85% to 115% noise
		const sumWeights = rawWeights.reduce((a, b) => a + b, 0);
		const normalizedWeights = rawWeights.map(w => w / sumWeights);

		return normalizedWeights.map((w, i) => ({
			chunkIndex: i + 1,
			size: parseFloat((totalSize * w).toFixed(6))
		}));
	}

	/**
	 * VWAP (Volume Weighted Average Price) takvimi oluşturur.
	 * Hacim U-Eğrisini (intraday U-curve) simüle eden hacim dizisine göre parçalama yapar.
	 * 
	 * @param totalSize - Yürütülecek toplam emir büyüklüğü (adet cinsinden)
	 * @param historicalVolumes - Son pencerelerdeki işlem hacimleri dizisi (boşsa U-Eğrisi üretilir)
	 */
	public generateVwapSchedule(totalSize: number, historicalVolumes: number[] = []): ExecutionChunk[] {
		// If no volumes provided, generate a standard U-Curve intraday volume curve
		let volumes = historicalVolumes;
		if (volumes.length === 0) {
			volumes = [1000, 600, 400, 500, 950]; // U-shape volume curve (high at start/end)
		}

		const totalVolume = volumes.reduce((a, b) => a + b, 0);
		if (totalVolume <= 0) {
			return [{ chunkIndex: 1, size: totalSize }];
		}

		const schedule: ExecutionChunk[] = [];
		
		volumes.forEach((vol, idx) => {
			const volumeRatio = vol / totalVolume;
			const chunkSize = totalSize * volumeRatio;

			schedule.push({
				chunkIndex: idx + 1,
				size: parseFloat(chunkSize.toFixed(6)),
				participationRate: parseFloat((volumeRatio * 100).toFixed(2))
			});
		});

		return schedule;
	}
}
