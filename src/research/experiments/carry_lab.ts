// ============================================================================
// KRIPTOQUANT RESEARCH — Carry Lab (Funding Hasadı / "Kazanan Taraf" Testi)
// ============================================================================
// Hipotez: Yön tahmini yerine YAPISAL gelir — cash & carry:
//   Spot AL + aynı miktarda perp SHORT = fiyat riski ~sıfır (delta-nötr).
//   Funding pozitifken kaldıraçlı long'lar short tarafına her 8 saatte bir
//   funding öder → biz TOPLAYAN taraf oluruz.
// Kurallar:
//   - Sinyal: son 3 funding'in ortalaması > eşik → pozisyona GİR/KAL;
//     eşiğin altına inince ÇIK. (Her 8 saatte bir değerlendirilir.)
//   - Getiri: pozisyondayken her funding tahsil edilir (rate * notional).
//   - Maliyet: giriş/çıkışta çift bacak işlem: spot %0.10+%0.05 slip,
//     perp %0.05+%0.05 slip → tur başına ~%0.50 (giriş+çıkış toplam).
//   - Fiyat riski yok varsayılır (basis riski ihmal — not düşülür).
// Çalıştır: npx tsx src/research/experiments/carry_lab.ts
// ============================================================================

import { getFundingRates } from '../../data/funding-fetcher.js';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const DAYS = 365;

// Çift bacak tur maliyeti (giriş + çıkış, iki bacak): 2*(0.10+0.05)% spot + 2*(0.05+0.05)% perp
const ROUND_TRIP_COST = 0.005; // %0.50

const THRESHOLDS = [0.0, 0.00003, 0.0001]; // 8 saatlik funding eşiği (0, %0.003, %0.01)

async function main() {
	const endTime = Date.now();
	const startTime = endTime - DAYS * 86400000;

	console.log(`\n💰 CARRY LAB — funding hasadı (delta-nötr) | ${DAYS} gün | tur maliyeti %${(ROUND_TRIP_COST * 100).toFixed(2)}`);

	for (const coin of COINS) {
		const rates = (await getFundingRates(coin, startTime, endTime)).filter(
			(r) => r.fundingTime >= startTime && r.fundingTime <= endTime,
		);
		if (rates.length < 100) {
			console.log(`  ${coin}: veri yetersiz (${rates.length})`);
			continue;
		}

		// Genel istatistik
		const totalIfAlwaysIn = rates.reduce((s, r) => s + r.fundingRate, 0);
		const positiveCount = rates.filter((r) => r.fundingRate > 0).length;

		console.log(`\n━━━ ${coin} — ${rates.length} funding periyodu (8s) ━━━`);
		console.log(`  Funding pozitif zaman oranı : %${((positiveCount / rates.length) * 100).toFixed(1)}`);
		console.log(`  Hep içeride kalsaydın (maliyetsiz): %${(totalIfAlwaysIn * 100).toFixed(2)} yıllık`);

		for (const th of THRESHOLDS) {
			let inPos = false;
			let collected = 0;
			let roundTrips = 0;

			for (let i = 3; i < rates.length; i++) {
				const avg3 = (rates[i - 1].fundingRate + rates[i - 2].fundingRate + rates[i - 3].fundingRate) / 3;
				if (!inPos && avg3 > th) {
					inPos = true;
					roundTrips++;
				} else if (inPos && avg3 <= th) {
					inPos = false;
				}
				if (inPos) collected += rates[i].fundingRate;
			}

			const gross = collected * 100;
			const cost = roundTrips * ROUND_TRIP_COST * 100;
			const net = gross - cost;
			console.log(
				`  Eşik %${(th * 100).toFixed(3).padEnd(6)} → brüt: %${gross.toFixed(2).padStart(6)} | tur: ${String(roundTrips).padStart(3)} | maliyet: %${cost.toFixed(2).padStart(5)} | NET: %${net.toFixed(2).padStart(6)}/yıl`,
			);
		}
	}

	console.log('\nNot: Basis (spot-perp makas) riski ve teminat faizi modellenmedi.');
	console.log('Bitti.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
