import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function analyzeParibuVolumes() {
	try {
		// Read raw content from steps log (which has the ticker JSON)
		const filePath = '/Users/erdemaslan/.gemini/antigravity/brain/166d07b1-e336-4cca-b36f-c03e10880ca4/.system_generated/steps/5962/content.md';
		const rawContent = readFileSync(filePath, 'utf-8');
		
		// Find the JSON line (starts at line 9 or after ---)
		const parts = rawContent.split('---');
		const jsonString = parts[1].trim();
		const ticker = JSON.parse(jsonString);
		
		const list = [];
		for (const [pair, data] of Object.entries(ticker)) {
			const lastPrice = data.last || 0;
			const volume = data.volume || 0;
			
			let volumeInTl = 0;
			if (pair.endsWith('_TL')) {
				volumeInTl = volume * lastPrice;
			} else if (pair.endsWith('_USDT')) {
				// Convert USDT volume to TL using USDT_TL price
				const usdtRate = ticker['USDT_TL'] ? ticker['USDT_TL'].last : 46.5;
				volumeInTl = volume * lastPrice * usdtRate;
			}
			
			list.push({
				pair,
				lastPrice,
				volume,
				volumeInTl
			});
		}
		
		// Sort by volume in TL descending
		list.sort((a, b) => b.volumeInTl - a.volumeInTl);
		
		console.log('\n================================================================');
		console.log('📊 PARIBU TOP 15 TRADING PAIRS BY 24-HOUR VOLUME (IN TL)');
		console.log('================================================================');
		for (let i = 0; i < Math.min(15, list.length); i++) {
			const item = list[i];
			const volFormatted = item.volumeInTl.toLocaleString(undefined, { maximumFractionDigits: 0 });
			const rawVol = item.volume.toLocaleString(undefined, { maximumFractionDigits: 2 });
			const unit = item.pair.split('_')[0];
			console.log(`${i+1}. ${item.pair.padEnd(12)} | 24h Hacim: ${volFormatted.padStart(15)} TL (Yaklaşık: ${rawVol} ${unit})`);
		}
		
		// Also find specific coins if they aren't in top 15
		const near = list.find(x => x.pair === 'NEAR_TL');
		if (near) {
			console.log('\n--- Ek Bilgi (NEAR_TL) ---');
			console.log(`NEAR_TL      | 24h Hacim: ${near.volumeInTl.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(15)} TL (${near.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} NEAR)`);
		}
		
	} catch (e) {
		console.error(`Failed to analyze Paribu volumes: ${e.message}`);
	}
}

analyzeParibuVolumes();
