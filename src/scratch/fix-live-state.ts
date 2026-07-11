// ============================================================================
// KRIPTOQUANT SCRATCH — Live State Recovery Script (CORRECTED)
// ============================================================================
// Kademeli kâr alım (Partial TP) proceeds açığından dolayı bozulan canlı/paper
// JSON durum dosyalarını otomatik tamir eder. İşlem geçmişinden kasa, realized PnL
// ve equity değerlerini sıfırdan kuruşu kuruşuna yeniden inşa eder.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const resultsDir = join(process.cwd(), 'results');

if (!existsSync(resultsDir)) {
	console.error(`[🔴 HATA] results klasörü bulunamadı: ${resultsDir}`);
	process.exit(1);
}

const files = readdirSync(resultsDir).filter(f => f.startsWith('live_paper_state_') && f.endsWith('.json'));

console.log(`\n======================================================`);
console.log(`[⚙️] CANLI DURUM DOSYALARI ONARIM BAŞLIYOR...`);
console.log(`======================================================`);

for (const file of files) {
	const filePath = join(resultsDir, file);
	try {
		const raw = readFileSync(filePath, 'utf-8');
		const state = JSON.parse(raw);

		console.log(`\n📄 Dosya: ${file}`);
		console.log(`   [Eski Durum] Kasa: $${state.cash?.toFixed(2)} | Realized PnL: $${state.realizedPnL?.toFixed(2)}`);

		// Kasa ve Realized PnL'i sıfırdan yeniden hesapla
		let correctCash = 10000; // Başlangıç kasası
		let correctRealizedPnL = 0;

		// 1. Aktif pozisyonların güncel giriş bütçelerini düş (kasadan ayrılan para)
		if (state.activePositions && state.activePositions.length > 0) {
			for (const pos of state.activePositions) {
				correctCash -= pos.positionSizeUsdt;
			}
		}

		// 2. Kapatılan tüm işlemlerin net PnL değerlerini kasaya ekle
		// Doğru Formül: kasa = başlangıç_kasası - aktif_pozisyonlar + toplam_gerçekleşen_pnl
		if (state.closedTrades && state.closedTrades.length > 0) {
			for (const trade of state.closedTrades) {
				correctCash += trade.realizedPnLUsdt;
				correctRealizedPnL += trade.realizedPnLUsdt;
			}
		}

		// 3. Güncel Equity hesaplaması
		let unrealized = 0;
		let posTotalValue = 0;
		if (state.activePositions && state.activePositions.length > 0) {
			for (const pos of state.activePositions) {
				posTotalValue += pos.entryPrice * pos.quantity;
				unrealized += pos.currentPnLUsdt || 0;
			}
		}
		const correctEquity = correctCash + posTotalValue + unrealized;

		// Değerleri güncelle
		state.cash = Number(correctCash.toFixed(4));
		state.realizedPnL = Number(correctRealizedPnL.toFixed(4));
		state.currentEquity = Number(correctEquity.toFixed(4));

		// Dosyayı diske geri yaz
		writeFileSync(filePath, JSON.stringify(state, null, 4));

		console.log(`   [🟢 TAMİR EDİLDİ] Yeni Kasa: $${state.cash.toFixed(2)} | Realized PnL: $${state.realizedPnL.toFixed(2)} | Equity: $${state.currentEquity.toFixed(2)}`);
	} catch (e: any) {
		console.error(`   [🔴 HATA] Dosya onarılamadı: ${file}. Hata: ${e.message}`);
	}
}

console.log(`\n======================================================`);
console.log(` [🚀] Onarım başarıyla tamamlandı!`);
console.log(`======================================================\n`);
