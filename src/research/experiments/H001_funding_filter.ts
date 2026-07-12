// ============================================================================
// KRIPTOQUANT RESEARCH — Hypothesis H001: Funding Rate Filter (Sprint 29)
// ============================================================================
// Tarihsel Binance Futures fonlama oranlarını çekip entegre ederek,
// persentil tabanlı fonlama filtresinin Sharpe, Getiri ve Drawdown üzerindeki
// etkisini ölçen hipotez test koşucusu.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAndStore } from '../../data/fetcher.js';
import { getFundingRates, mergeCandlesWithFunding } from '../../data/funding-fetcher.js';
import { runBacktest } from '../backtester.js';
import { createA2Strategy } from '../strategies/a2/index.js';
import { createA2V2Strategy } from '../strategies/a2-v2/index.js';
import { createBollingerBandsV2Strategy } from '../strategies/bollinger-bands-v2/index.js';

async function runExperiment() {
	const symbol = 'BTCUSDT';
	const interval = '15m';
	
	// Son 60 günü backtest edelim
	const endTime = Date.now();
	const startTime = endTime - 60 * 24 * 60 * 60 * 1000;
	
	console.log(`\n======================================================`);
	console.log(`🔬 HİPOTEZ H001 DENEYİ BAŞLIYOR...`);
	console.log(`   Varlık: ${symbol} | Zaman Dilimi: ${interval}`);
	console.log(`   Periyot: ${new Date(startTime).toISOString().slice(0, 10)} - ${new Date(endTime).toISOString().slice(0, 10)}`);
	console.log(`======================================================\n`);

	// 1. Mum verilerini yükle
	const rawCandles = await fetchAndStore(symbol, interval, { startTime, endTime });
	if (rawCandles.length === 0) {
		console.error('[🔴 HATA] Mum verisi yüklenemedi.');
		return;
	}

	// 2. Fonlama verilerini yükle ve birleştir
	const fundingRates = await getFundingRates(symbol, startTime, endTime);
	const candles = mergeCandlesWithFunding(rawCandles, fundingRates);
	
	console.log(`[🟢 VERİ BAĞLANTISI TAMAM] ${candles.length} mum başarıyla fonlama oranlarıyla birleştirildi.\n`);

	// 3. Konfigürasyonlar
	const platformConfig = {
		coins: [symbol],
		defaultInterval: interval,
		initialCapital: 10000,
		commissionPercent: 0.0010, // 0.1% Binance TR komisyonu
		slippagePercent: 0.0005,   // 0.05% kayma
	};

	const riskConfigNormal = {
		maxPositionPercent: 10,
		maxDailyLossPercent: 5,
		maxOrderValue: 1000,
		stopLossAtrMultiplier: 2.0,
		enableFundingFilter: false,
	};

	// En yüksek %5'lik fonlama persentili veto eşiği
	const riskConfigFiltered = {
		maxPositionPercent: 10,
		maxDailyLossPercent: 5,
		maxOrderValue: 1000,
		stopLossAtrMultiplier: 2.0,
		enableFundingFilter: true,
		fundingPercentileThreshold: 0.95, 
	};

	// Denenecek stratejiler
	const strategies = [
		{ name: 'A2 Bollinger (Volt)', instance: createA2Strategy() },
		{ name: 'A2 Bollinger v2', instance: createA2V2Strategy() },
		{ name: 'Bollinger Bands v2', instance: createBollingerBandsV2Strategy() }
	];

	const resultsTable: any[] = [];
	let reportMarkdown = `# Hipotez H001: Funding Rate Filtresi Performans Raporu\n\n`;
	reportMarkdown += `* **Test Tarihi:** ${new Date().toISOString().slice(0, 10)}\n`;
	reportMarkdown += `* **Test Edilen Varlık:** ${symbol} (${interval})\n`;
	reportMarkdown += `* **Test Aralığı:** ${new Date(startTime).toISOString().slice(0, 10)} - ${new Date(endTime).toISOString().slice(0, 10)}\n`;
	reportMarkdown += `* **Filtre Koşulu:** Funding Rate >= 95. Persentil (Aşırı Isınmış Piyasa Veto)\n\n`;
	reportMarkdown += `## Karşılaştırma Sonuçları\n\n`;
	reportMarkdown += `| Strateji | Filtre Durumu | Başlangıç | Bitiş Kasa | Toplam Getiri | Sharpe | Max Drawdown | Kâr Faktörü | Toplam İşlem | Win Rate |\n`;
	reportMarkdown += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

	for (const strat of strategies) {
		console.log(`Running backtest for ${strat.name}...`);
		
		// 1) Filtresiz Çalışma
		const normalRes = runBacktest(strat.instance, candles, platformConfig, riskConfigNormal, symbol);
		
		// 2) Filtreli Çalışma
		const filteredRes = runBacktest(strat.instance, candles, platformConfig, riskConfigFiltered, symbol);

		resultsTable.push({
			Strateji: strat.name,
			'Filtre Durumu': 'NORMAL',
			FinalCapital: normalRes.finalCapital,
			Return: normalRes.totalReturn,
			Sharpe: normalRes.sharpeRatio,
			MaxDrawdown: normalRes.maxDrawdown,
			ProfitFactor: normalRes.profitFactor,
			Trades: normalRes.totalTrades,
			WinRate: normalRes.winRate
		});

		resultsTable.push({
			Strateji: strat.name,
			'Filtre Durumu': 'FILTRELİ (Percentile >= 95%)',
			FinalCapital: filteredRes.finalCapital,
			Return: filteredRes.totalReturn,
			Sharpe: filteredRes.sharpeRatio,
			MaxDrawdown: filteredRes.maxDrawdown,
			ProfitFactor: filteredRes.profitFactor,
			Trades: filteredRes.totalTrades,
			WinRate: filteredRes.winRate
		});

		// Markdown satırlarını oluştur
		reportMarkdown += `| **${strat.name}** | NORMAL | $10,000 | $${normalRes.finalCapital.toFixed(2)} | **${normalRes.totalReturn.toFixed(2)}%** | ${normalRes.sharpeRatio.toFixed(3)} | ${normalRes.maxDrawdown.toFixed(2)}% | ${normalRes.profitFactor.toFixed(2)} | ${normalRes.totalTrades} | ${normalRes.winRate.toFixed(1)}% |\n`;
		reportMarkdown += `| **${strat.name}** | FILTRELİ | $10,000 | $${filteredRes.finalCapital.toFixed(2)} | **${filteredRes.totalReturn.toFixed(2)}%** | ${filteredRes.sharpeRatio.toFixed(3)} | ${filteredRes.maxDrawdown.toFixed(2)}% | ${filteredRes.profitFactor.toFixed(2)} | ${filteredRes.totalTrades} | ${filteredRes.winRate.toFixed(1)}% |\n`;
	}

	console.clear();
	console.log(`\n========================================================================================`);
	console.log(`📊 HİPOTEZ H001 KARŞILAŞTIRMA SONUÇLARI (BTCUSDT 15M - 60 GÜN)`);
	console.log(`========================================================================================`);
	console.table(resultsTable);
	console.log(`========================================================================================\n`);

	// Bulguları ekle
	reportMarkdown += `\n## Temel Bulgular ve Yorumlar\n\n`;
	
	// Bulguları kaydet
	const resultsDir = join(process.cwd(), 'results');
	if (!existsSync(resultsDir)) {
		mkdirSync(resultsDir, { recursive: true });
	}
	const reportPath = join(resultsDir, 'H001_funding_filter_report.md');
	writeFileSync(reportPath, reportMarkdown, 'utf-8');
	console.log(`[💾 RAPOR KAYDEDİLDİ] Karşılaştırma raporu diske yazıldı: ${reportPath}\n`);
}

runExperiment().catch(err => {
	console.error('Deney yürütülürken hata oluştu:', err);
});
