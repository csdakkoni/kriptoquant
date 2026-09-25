// ============================================================================
// KRIPTOQUANT — Canlı Testnet Deneme Emri Aracı
// ============================================================================
// Kullanım:
//   node test-order.cjs open   → Binance Testnet'te pozisyon açar ve Dashboard'a işler
//   node test-order.cjs close  → Pozisyonu kapatır ve açık emirleri temizler
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ccxt = require('ccxt');
const dotenv = require('dotenv');

// .env yükle
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
	dotenv.config({ path: envPath });
}

const apiKey = process.env.BINANCE_API_KEY;
const secret = process.env.BINANCE_SECRET;
const isTestnet = process.env.BINANCE_USE_TESTNET === 'true';

if (!apiKey || !secret) {
	console.error('❌ HATA: .env dosyasında BINANCE_API_KEY veya BINANCE_SECRET bulunamadı!');
	process.exit(1);
}

const exchange = new ccxt.binance({
	apiKey,
	secret,
	enableRateLimit: true,
	options: {
		defaultType: 'future',
		disableFuturesSandboxWarning: true,
	},
});

if (isTestnet) {
	exchange.setSandboxMode(true);
}

const dataDir = path.join(__dirname, 'organism-data');
const expFile = path.join(dataDir, 'experiments.json');
const coin = 'SOLUSDT';
const symbol = 'SOL/USDT:USDT';
const amountUsd = Number(process.env.MAX_TRADE_SIZE_USD) || 20;

async function openTestOrder() {
	console.log(`\n🚀 [TEST ORDER] Binance ${isTestnet ? 'TESTNET' : 'CANLI'} üzerinde deneme emri açılıyor...`);
	await exchange.loadMarkets();

	// 1. Marjin ve Kaldıraç Kilidi
	try {
		await exchange.setMarginMode('ISOLATED', symbol);
		console.log('   ✓ Marjin Modu: ISOLATED (İzole)');
	} catch (e) {
		// Ignore if already set
	}

	try {
		await exchange.setLeverage(1, symbol);
		console.log('   ✓ Kaldıraç: 1x (Spot güvencesi)');
	} catch (e) {
		// Ignore
	}

	// 2. Fiyat ve Miktar
	const ticker = await exchange.fetchTicker(symbol);
	const currentPrice = ticker.last;
	const rawAmount = amountUsd / currentPrice;
	const preciseAmountStr = exchange.amountToPrecision(symbol, rawAmount);
	const preciseAmount = Number(preciseAmountStr);

	console.log(`   ✓ Güncel Fiyat: $${currentPrice}`);
	console.log(`   ✓ İşlem Tutarı: ${preciseAmount} SOL (~$${amountUsd})`);

	// 3. Market Giriş Emri
	console.log('   📡 Market BUY emri borsaya iletiliyor...');
	const entryOrder = await exchange.createMarketOrder(symbol, 'buy', preciseAmount);
	const filledPrice = Number(entryOrder.average || entryOrder.price || currentPrice);
	console.log(`   ✅ GİRİŞ BAŞARILI! Dolum Fiyatı: $${filledPrice} (Emir ID: ${entryOrder.id})`);

	// 4. Bracket STOP_MARKET Emri (-%3)
	const stopPrice = Number(exchange.priceToPrecision(symbol, filledPrice * 0.97));
	console.log(`   🛡️ STOP_MARKET emri yerleştiriliyor @ $${stopPrice}...`);
	const stopOrder = await exchange.createOrder(symbol, 'STOP_MARKET', 'sell', preciseAmount, undefined, {
		stopPrice,
		reduceOnly: true,
	});
	console.log(`   ✅ STOP_MARKET asıldı! (Emir ID: ${stopOrder.id})`);

	// 5. Bracket TAKE_PROFIT_MARKET Emri (+%6)
	const targetPrice = Number(exchange.priceToPrecision(symbol, filledPrice * 1.06));
	console.log(`   🎯 TAKE_PROFIT_MARKET emri yerleştiriliyor @ $${targetPrice}...`);
	const tpOrder = await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', 'sell', preciseAmount, undefined, {
		stopPrice: targetPrice,
		reduceOnly: true,
	});
	console.log(`   ✅ TAKE_PROFIT_MARKET asıldı! (Emir ID: ${tpOrder.id})`);

	// 6. Dashboard (experiments.json) ile Eşitleme
	if (fs.existsSync(expFile)) {
		const exps = JSON.parse(fs.readFileSync(expFile, 'utf8'));
		if (exps.length > 0) {
			const exp = exps[0]; // İlk deneyin altına ekle
			const pos = {
				id: crypto.randomUUID(),
				experimentId: exp.id,
				coin,
				side: 'long',
				entryPrice: filledPrice,
				entryTime: Date.now(),
				candlesSinceEntry: 0,
				highSinceEntry: filledPrice,
				lowSinceEntry: filledPrice,
				isLive: true,
				liveOrderId: entryOrder.id,
				stopOrderId: stopOrder.id,
				takeProfitOrderId: tpOrder.id,
			};
			exp.positions.push(pos);
			fs.writeFileSync(expFile, JSON.stringify(exps, null, 2));
			console.log(`   📊 Dashboard'a işlendi! (${exp.name} altında görünecek)`);
		}
	}

	console.log('\n============================================================');
	console.log('🎉 TEBRİKLER! Deneme emri başarıyla açıldı.');
	console.log('👉 Dashboard\'unuzu (http://34.107.2.151:3008) açıp bakın:');
	console.log('   🟢 CANLI (Testnet) rozetiyle SOLUSDT pozisyonunu göreceksiniz.');
	console.log('👉 testnet.binancefuture.com ekranından da teyit edebilirsiniz.');
	console.log('------------------------------------------------------------');
	console.log('Kapatmak istediğinizde şu komutu çalıştırmanız yeterli:');
	console.log('node test-order.cjs close');
	console.log('============================================================\n');
}

async function closeTestOrder() {
	console.log(`\n🚪 [TEST ORDER] Binance ${isTestnet ? 'TESTNET' : 'CANLI'} pozisyonu kapatılıyor...`);
	await exchange.loadMarkets();

	// 1. Bekleyen bracket emirlerini temizle
	console.log('   🧹 Borsa tarafındaki bekleyen tüm Stop/TP emirleri iptal ediliyor...');
	try {
		await exchange.cancelAllOrders(symbol);
		console.log('   ✓ Açık emirler iptal edildi.');
	} catch (e) {
		console.log('   ℹ️ İptal edilecek bekleyen emir yoktu.');
	}

	// 2. Açık pozisyonu kontrol et ve kapat
	const positions = await exchange.fetchPositions([symbol]);
	const activePos = positions.find((p) => p.symbol === symbol && Math.abs(Number(p.contracts || 0)) > 0);

	let exitPrice = 0;
	if (activePos && Math.abs(Number(activePos.contracts)) > 0) {
		const contracts = Math.abs(Number(activePos.contracts));
		console.log(`   📡 ${contracts} SOL piyasa emriyle kapatılıyor (reduceOnly)...`);
		const closeOrder = await exchange.createMarketOrder(symbol, 'sell', contracts, undefined, { reduceOnly: true });
		exitPrice = Number(closeOrder.average || closeOrder.price || activePos.markPrice || activePos.entryPrice);
		console.log(`   ✅ POZİSYON KAPATILDI! Kapanış Fiyatı: $${exitPrice}`);
	} else {
		console.log('   ℹ️ Borsada açık pozisyon bulunamadı (zaten kapalı).');
	}

	// 3. Dashboard (experiments.json) güncelle
	if (fs.existsSync(expFile)) {
		const exps = JSON.parse(fs.readFileSync(expFile, 'utf8'));
		let updated = false;

		for (const exp of exps) {
			const openPosIdx = exp.positions.findIndex((p) => p.coin === coin);
			if (openPosIdx !== -1) {
				const pos = exp.positions[openPosIdx];
				const closePrice = exitPrice || pos.entryPrice;
				const pnlPct = ((closePrice - pos.entryPrice) / pos.entryPrice) * 100 - 0.3;

				pos.exitPrice = closePrice;
				pos.exitTime = Date.now();
				pos.exitReason = 'take_profit';
				pos.pnlPercent = pnlPct;

				exp.closedPositions.push({ ...pos });
				exp.positions.splice(openPosIdx, 1);
				updated = true;
				console.log(`   📊 Dashboard'da pozisyon arşive alındı. PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`);
				break;
			}
		}

		if (updated) {
			fs.writeFileSync(expFile, JSON.stringify(exps, null, 2));
		}
	}

	console.log('\n============================================================');
	console.log('✅ TEMİZLİK TAMAMLANDI! Pozisyon başarıyla kapatıldı.');
	console.log('👉 Dashboard tablonuzda geçmiş işlemlere taşındı.');
	console.log('============================================================\n');
}

const action = process.argv[2];
if (action === 'open') {
	openTestOrder().catch(console.error);
} else if (action === 'close') {
	closeTestOrder().catch(console.error);
} else {
	console.log('Kullanım:');
	console.log('  node test-order.cjs open   (Pozisyon aç)');
	console.log('  node test-order.cjs close  (Pozisyonu kapat)');
}
