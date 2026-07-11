// ============================================================================
// KRIPTOQUANT SCRATCH — Fetch BIST Data from Yahoo Finance
// ============================================================================
// Borsa İstanbul hisselerini (örn: THYAO.IS, EREGL.IS) Yahoo Finance üzerinden
// çekip KriptoQuant mum formatına dönüştürerek data/raw/ altına kaydeder.
// ============================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const symbol = process.argv[2] || 'THYAO';
const range = process.argv[3] || '2y'; // 1y, 2y, 5y, max
const interval = '1d';

const yahooSymbol = symbol.includes('.') ? symbol : `${symbol}.IS`;
const targetFileName = `${symbol.split('.')[0]}_${interval}.json`;

const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=${range}&interval=${interval}`;

console.log(`[🚀] Yahoo Finance'den BIST verisi indiriliyor: ${yahooSymbol} (${range})`);

async function run() {
	try {
		const response = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
			}
		});

		if (!response.ok) {
			throw new Error(`Yahoo HTTP Hatası: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		const result = data.chart?.result?.[0];

		if (!result) {
			throw new Error('Geçersiz Yahoo verisi yapısı.');
		}

		const timestamps = result.timestamp || [];
		const quote = result.indicators?.quote?.[0] || {};
		const opens = quote.open || [];
		const highs = quote.high || [];
		const lows = quote.low || [];
		const closes = quote.close || [];
		const volumes = quote.volume || [];

		const candles = [];

		for (let i = 0; i < timestamps.length; i++) {
			const t = timestamps[i];
			const o = opens[i];
			const h = highs[i];
			const l = lows[i];
			const c = closes[i];
			const v = volumes[i];

			// Boş veya hatalı günleri filtrele (hafta sonları / tatillerde null gelebiliyor)
			if (o === null || h === null || l === null || c === null || Number.isNaN(o)) {
				continue;
			}

			candles.push({
				openTime: t * 1000,
				open: parseFloat(o.toFixed(4)),
				high: parseFloat(h.toFixed(4)),
				low: parseFloat(l.toFixed(4)),
				close: parseFloat(c.toFixed(4)),
				volume: v ? Math.round(v) : 0,
				closeTime: (t * 1000) + 86399999
			});
		}

		if (candles.length === 0) {
			throw new Error('Sıfır geçerli mum verisi bulundu.');
		}

		const dataDir = join(import.meta.dirname, '../../data/raw');
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		const targetPath = join(dataDir, targetFileName);
		writeFileSync(targetPath, JSON.stringify(candles, null, 2), 'utf-8');

		console.log(`[🟢 SUCCESS] ${candles.length} adet mum verisi başarıyla kaydedildi!`);
		console.log(`[📂 Dosya Yolu]: ${targetPath}`);
		console.log(`\nArtık şu komutla BIST backtestini çalıştırabilirsiniz:`);
		console.log(`npm run backtest -- --strategy bollinger-bands --coin ${symbol.split('.')[0]} --interval 1d`);

	} catch (err) {
		console.error('[🔴 HATA]', err.message);
		process.exit(1);
	}
}

run();
