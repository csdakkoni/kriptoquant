// ============================================================================
// KRIPTOQUANT SCRATCH — BIST Raw Strategy Backtester
// ============================================================================
// Platform filtrelerini (ADX, RVOL) tamamen bypass ederek, stratejinin ham
// (raw) sinyalleriyle BIST hisselerinde backtest simülasyonu çalıştırır.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createBollingerBandsV2Strategy } from '../research/strategies/bollinger-bands-v2/index.js';
import { createBollingerBandsTimestampStrategy } from '../research/strategies/bollinger-bands-timestamp/index.js';
import { createA2V2Strategy } from '../research/strategies/a2-v2/index.js';
import type { Candle, Signal } from '../core/types.js';

const strategyName = process.argv[2] || 'bollinger-bands-v2';
const symbol = process.argv[3] || 'THYAO';
const range = process.argv[4] || 'all'; // '1y' veya 'all'
const interval = '1d';

const dataPath = join(import.meta.dirname, `../../data/raw/${symbol}_${interval}.json`);

if (!existsSync(dataPath)) {
	console.error(`[🔴 HATA] Veri dosyası bulunamadı: ${dataPath}`);
	console.error('Önce fetch-bist-data.js ile veriyi çekmelisiniz.');
	process.exit(1);
}

// 1. Mum Verilerini Yükle
const raw = readFileSync(dataPath, 'utf-8');
const candles = JSON.parse(raw) as Candle[];
console.log(`\n[📂] ${candles.length} adet ${symbol} mumu yüklendi.`);

// 2. Strateji Seçimi
let strategy: any;
if (strategyName === 'bollinger-bands-v2' || strategyName === 'bollinger-bands') {
	strategy = createBollingerBandsV2Strategy();
} else if (strategyName === 'bollinger-bands-timestamp') {
	strategy = createBollingerBandsTimestampStrategy();
} else if (strategyName === 'a2-v2') {
	strategy = createA2V2Strategy();
} else {
	console.error(`[🔴 HATA] Desteklenmeyen veya geçersiz strateji: ${strategyName}`);
	process.exit(1);
}

// 3. Ham Sinyalleri Al (Warmup için tüm veriyle hesaplanır)
const signals = strategy.evaluate(candles);

// 4. Zaman Aralığı Filtreleme (Son 1 Yıl vb.)
let startIndex = 30;
if (range === '1y' && candles.length > 0) {
	const lastTime = candles[candles.length - 1].openTime;
	const oneYearMs = 365 * 24 * 60 * 60 * 1000;
	const cutoffTime = lastTime - oneYearMs;

	const idx = candles.findIndex(c => c.openTime >= cutoffTime);
	if (idx !== -1) {
		startIndex = Math.max(30, idx);
		console.log(`[⏰] Sadece son 1 yıl simüle ediliyor (Başlangıç Tarihi: ${new Date(candles[startIndex].openTime).toLocaleDateString()})`);
	}
}

// 5. Filtresiz Simülasyon
let cash = 10000;
let position: { entryPrice: number; quantity: number; entryTime: number; stopLoss: number; partialTpTriggered: boolean } | null = null;
let tradesCount = 0;
let wins = 0;
let losses = 0;
let totalPnL = 0;

for (let i = startIndex; i < candles.length; i++) {
	const current = candles[i];
	const price = current.close;

	// Aktif pozisyon kontrolü (Stop Loss & Take Profit / Risk Yönetimi)
	if (position) {
		const entryPrice = position.entryPrice;

		// 1. Stop Loss check
		if (price <= position.stopLoss) {
			const exitPrice = position.stopLoss;
			const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
			const pnlUsdt = position.quantity * (exitPrice - entryPrice);

			cash += position.quantity * exitPrice;
			totalPnL += pnlUsdt;
			tradesCount++;
			if (pnlPercent > 0) wins++; else losses++;

			console.log(`🔴 [SL] Çıkış: $${exitPrice.toFixed(2)} | PnL: %${pnlPercent.toFixed(2)} ($${pnlUsdt.toFixed(2)}) | Neden: Stop-Loss`);
			position = null;
			continue;
		}

		// 2. Kademeli Kar Al (Partial TP) - Sadece Bollinger Bands V2 için geçerli
		if (strategyName === 'bollinger-bands-v2' && !position.partialTpTriggered) {
			const segment = candles.slice(i - 20, i);
			const sma20 = segment.reduce((sum, c) => sum + c.close, 0) / 20;

			if (price >= sma20) {
				const sellQty = position.quantity / 2;
				const pnlUsdt = sellQty * (price - entryPrice);
				
				cash += sellQty * price;
				totalPnL += pnlUsdt;

				position.quantity -= sellQty;
				position.stopLoss = entryPrice; // SL'i başabaş noktasına çek
				position.partialTpTriggered = true;

				console.log(`🟢 [PARTIAL TP] Orta Bandda %50 Satıldı. Fiyat: $${price.toFixed(2)} | SL Girişe Çekildi: $${entryPrice.toFixed(2)}`);
			}
		}
	}

	// Sinyal Değerlendirme
	const signal = signals.find(s => s.timestamp === current.openTime);
	if (signal) {
		if (signal.side === 'BUY' && !position) {
			// Pozisyon Aç
			const quantity = cash / price;
			const initialAtr = price * 0.02; // Varsayılan ATR
			
			let stopLoss = price * 0.95;
			if (strategyName === 'bollinger-bands-v2') {
				stopLoss = price - 2 * initialAtr;
			} else if (strategyName === 'bollinger-bands') {
				stopLoss = price * (1 - 0.02098); // Sabit -2.098% Stop Loss
			}

			position = {
				entryPrice: price,
				quantity,
				entryTime: current.openTime,
				stopLoss,
				partialTpTriggered: false
			};
			cash = 0;
			console.log(`\n🔵 [LONG] Giriş: $${price.toFixed(2)} | Zaman: ${new Date(current.openTime).toLocaleDateString()}`);
		} else if (signal.side === 'SELL' && position) {
			// Pozisyon Kapat
			const exitPrice = price;
			const entryPrice = position.entryPrice;
			const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
			const pnlUsdt = position.quantity * (exitPrice - entryPrice);

			cash += position.quantity * exitPrice;
			totalPnL += pnlUsdt;
			tradesCount++;
			if (pnlPercent > 0) wins++; else losses++;

			console.log(`🔴 [SELL] Çıkış: $${exitPrice.toFixed(2)} | PnL: %${pnlPercent.toFixed(2)} ($${pnlUsdt.toFixed(2)}) | Neden: Karşıt Sinyal`);
			position = null;
		}
	}
}

// Açık pozisyon varsa son fiyattan kapat
if (position) {
	const lastCandle = candles[candles.length - 1];
	const exitPrice = lastCandle.close;
	const entryPrice = position.entryPrice;
	const pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
	const pnlUsdt = position.quantity * (exitPrice - entryPrice);
	cash += position.quantity * exitPrice;
	totalPnL += pnlUsdt;
	tradesCount++;
	if (pnlPercent > 0) wins++; else losses++;
	position = null;
}

const finalEquity = cash;
const returnPct = ((finalEquity - 10000) / 10000) * 100;
const winRate = tradesCount > 0 ? (wins / tradesCount) * 100 : 0;

console.log('\n================================================================');
console.log(` 🏆 HAM STRATEJİ BACKTEST SONUCU — ${strategyName.toUpperCase()}`);
console.log('================================================================');
console.log(`  Hisse Senedi  : ${symbol}`);
console.log(`  Zaman Aralığı : ${range === '1y' ? 'Son 1 Yıl' : 'Tüm Veri'}`);
console.log(`  Başlangıç     : 10,000.00 USDT`);
console.log(`  Bitiş Kasası  : ${finalEquity.toFixed(2)} USDT`);
console.log(`  Net Getiri    : %${returnPct.toFixed(2)} (${totalPnL.toFixed(2)} USDT)`);
console.log(`  İşlem Sayısı  : ${tradesCount}`);
console.log(`  Kazanma Oranı : %${winRate.toFixed(2)} (${wins} Başarılı / ${losses} Başarısız)`);
console.log('================================================================\n');
