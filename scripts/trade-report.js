import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const resultsDir = join(process.cwd(), 'results');
if (!existsSync(resultsDir)) {
	console.error('Results directory not found.');
	process.exit(1);
}

const files = readdirSync(resultsDir).filter(f => f.startsWith('live_paper_state_') && f.endsWith('.json'));

let totalEquitySum = 0;
let totalCashSum = 0;
let totalRealizedPnL = 0;
const activePositions = [];
const closedTrades = [];

for (const file of files) {
	try {
		const raw = readFileSync(join(resultsDir, file), 'utf-8');
		const state = JSON.parse(raw);
		const strategyName = file.replace('live_paper_state_', '').replace('.json', '');

		totalEquitySum += state.currentEquity || state.cash;
		totalCashSum += state.cash;
		totalRealizedPnL += state.realizedPnL || 0;

		if (state.activePositions && Array.isArray(state.activePositions)) {
			for (const pos of state.activePositions) {
				activePositions.push({
					strategy: strategyName,
					coin: pos.coin,
					entryPrice: pos.entryPrice,
					currentPrice: pos.currentPrice,
					sizeUsdt: pos.positionSizeUsdt || 0,
					pnlPercent: pos.currentPnLPercent || 0,
					pnlUsdt: pos.currentPnLUsdt || 0
				});
			}
		}

		if (state.closedTrades && Array.isArray(state.closedTrades)) {
			for (const trade of state.closedTrades) {
				closedTrades.push({
					strategy: strategyName,
					coin: trade.coin,
					entryTime: trade.entryTime,
					exitTime: trade.exitTime,
					entryPrice: trade.entryPrice,
					exitPrice: trade.exitPrice,
					pnlPercent: trade.realizedPnLPercent || 0,
					pnlUsdt: trade.realizedPnLUsdt || 0,
					reason: trade.exitReason
				});
			}
		}
	} catch (e) {
		console.error(`Failed to read ${file}:`, e.message);
	}
}

console.log('\n================================================================================');
console.log('              📊 KRIPTOQUANT OTOPİLOT İŞLEM VE PERFORMANS RAPORU');
console.log('================================================================================');

console.log(`\n💵 PORTFÖY ÖZETİ:`);
console.log(`   - Toplam Bakiye (Equity): $${totalEquitySum.toFixed(2)}`);
console.log(`   - Toplam Nakit (Cash):    $${totalCashSum.toFixed(2)}`);
console.log(`   - Toplam Gerçekleşen Kâr/Zarar: $${totalRealizedPnL.toFixed(2)}`);

console.log(`\n📌 AKTİF POZİSYONLAR (${activePositions.length} Adet):`);
if (activePositions.length === 0) {
	console.log('   - Şu anda açık pozisyon bulunmuyor.');
} else {
	console.log('   --------------------------------------------------------------------------------------');
	console.log('   Strateji                  | Coin       | Bütçe   | Giriş      | Güncel     | PnL %    | PnL $');
	console.log('   --------------------------------------------------------------------------------------');
	activePositions.forEach(p => {
		const pnlSign = p.pnlPercent >= 0 ? '+' : '';
		console.log(
			`   ${p.strategy.padEnd(25)} | ${p.coin.padEnd(10)} | $${p.sizeUsdt.toFixed(0).padEnd(6)} | $${p.entryPrice.toFixed(4).padEnd(10)} | $${p.currentPrice.toFixed(4).padEnd(10)} | ${pnlSign}${p.pnlPercent.toFixed(2).padEnd(7)}% | $${pnlSign}${p.pnlUsdt.toFixed(2)}`
		);
	});
	console.log('   --------------------------------------------------------------------------------------');
}

console.log(`\n✅ KAPANAN İŞLEMLER (${closedTrades.length} Adet):`);
if (closedTrades.length === 0) {
	console.log('   - Son 5 saat içinde kapatılan işlem bulunmuyor.');
} else {
	console.log('   ---------------------------------------------------------------------------------------------------');
	console.log('   Strateji                  | Coin       | Giriş Price| Çıkış Price | Neden        | PnL %    | PnL $');
	console.log('   ---------------------------------------------------------------------------------------------------');
	closedTrades.forEach(t => {
		const pnlSign = t.pnlPercent >= 0 ? '+' : '';
		console.log(
			`   ${t.strategy.padEnd(25)} | ${t.coin.padEnd(10)} | $${t.entryPrice.toFixed(4).padEnd(10)} | $${t.exitPrice.toFixed(4).padEnd(11)} | ${t.reason.padEnd(12)} | ${pnlSign}${t.pnlPercent.toFixed(2).padEnd(7)}% | $${pnlSign}${t.pnlUsdt.toFixed(2)}`
		);
	});
	console.log('   ---------------------------------------------------------------------------------------------------');

	// Performans İstatistikleri
	const wins = closedTrades.filter(t => t.pnlPercent > 0).length;
	const losses = closedTrades.filter(t => t.pnlPercent <= 0).length;
	const winRate = (wins / closedTrades.length) * 100;
	
	const bestTrade = [...closedTrades].sort((a, b) => b.pnlPercent - a.pnlPercent)[0];
	const worstTrade = [...closedTrades].sort((a, b) => a.pnlPercent - b.pnlPercent)[0];

	console.log(`\n📊 İSTATİSTİKLER:`);
	console.log(`   - Toplam Kapanan İşlem: ${closedTrades.length} (Kazanılan: ${wins}, Kaybedilen: ${losses})`);
	console.log(`   - Başarı Oranı (Win Rate): ${winRate.toFixed(2)}%`);
	if (bestTrade) {
		console.log(`   - En İyi İşlem:  ${bestTrade.strategy} -> ${bestTrade.coin} (+%${bestTrade.pnlPercent.toFixed(2)} | +$${bestTrade.pnlUsdt.toFixed(2)})`);
	}
	if (worstTrade) {
		console.log(`   - En Kötü İşlem: ${worstTrade.strategy} -> ${worstTrade.coin} (-%${Math.abs(worstTrade.pnlPercent).toFixed(2)} | -$${Math.abs(worstTrade.pnlUsdt).toFixed(2)})`);
	}
}
console.log('================================================================================\n');
