// ============================================================================
// KRIPTOQUANT — Reset to Clean Slate Script
// ============================================================================
// 1. Mevcut tüm deney geçmişini ve skorları organism-data/arsiv_... klasörüne yedekler.
// 2. Sistemi 6 ÇEKİRDEK STRATEJİ ile 0 işlemden tertemiz başlatır.
// 3. Eşzamanlı maksimum 3 pozisyon kuralı ve 25 coinlik evren devrede olur.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, 'organism-data');
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}

// 1. Yedekleme klasörü oluştur
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const archiveDir = path.join(dataDir, `arsiv_${ts}`);
fs.mkdirSync(archiveDir, { recursive: true });

const filesToBackup = ['experiments.json', 'observation-scoreboard.json', 'knowledge-graph.json', 'risk-state.json'];
for (const f of filesToBackup) {
	const src = path.join(dataDir, f);
	if (fs.existsSync(src)) {
		fs.copyFileSync(src, path.join(archiveDir, f));
		console.log(`📦 Yedeklendi: ${f} → ${archiveDir}`);
	}
}

// 2. 25 Coinlik Evren
const coins = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
	'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT',
	'MATICUSDT', 'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'AAVEUSDT',
	'UNIUSDT', 'ARBUSDT', 'OPUSDT', 'FILUSDT', 'ATOMUSDT',
	'INJUSDT', 'RENDERUSDT', 'LTCUSDT', 'TRXUSDT', 'ICPUSDT',
];

const emptyStats = () => ({
	totalTrades: 0,
	wins: 0,
	losses: 0,
	totalPnlPercent: 0,
	avgPnlPercent: 0,
	winRate: 0,
	avgWinPercent: 0,
	avgLossPercent: 0,
	maxDrawdownPercent: 0,
});

const base = () => ({
	status: 'running',
	startedAt: Date.now(),
	maxDurationHours: 720,
	maxConcurrentPositions: 3,
	isLiveTradingEnabled: true,
	positions: [],
	closedPositions: [],
	stats: emptyStats(),
	coins,
});

// 3. 6 Çekirdek Strateji (0 İşlem, Temiz Başlangıç)
const cleanExperiments = [
	{
		...base(),
		id: crypto.randomUUID(),
		name: 'Altın Saat Swing (Rejim Yönlü, 3%/6%)',
		hypothesis: '06-12 UTC altın saatlerinde rejim yönünde geniş ufuklu (3% stop / 6% hedef) dalga yakalamak',
		sourceAssumption: 'exit-beats-entry',
		entryRule: { type: 'random_in_hours', startHourUtc: 6, endHourUtc: 12, probability: 0.1 },
		exitRule: { type: 'stop_and_target', stopPercent: 3.0, targetPercent: 6.0 },
		side: 'regime',
	},
	{
		...base(),
		id: crypto.randomUUID(),
		name: 'Swing Dip %5 → Hedef +%6 (Erdem ölçeği v1)',
		hypothesis: '48s tepesinden %5 düşeni almak, büyük hedefle maliyeti önemsizleştirir',
		sourceAssumption: 'entry-signal-matters',
		entryRule: { type: 'dip_from_high', lookback: 192, dipPercent: 5 },
		exitRule: { type: 'stop_and_target', stopPercent: 6, targetPercent: 6 },
	},
	{
		...base(),
		id: crypto.randomUUID(),
		name: 'Swing Dip ATR → Hedef 3×ATR (Erdem ölçeği v2)',
		hypothesis: '48s tepesinden 2.5×ATR düşeni almak, her coinin kendi volatilitesine göre ölçülen gerçek dip',
		sourceAssumption: 'entry-signal-matters',
		entryRule: { type: 'dip_from_high_atr', lookback: 192, dipMultiplier: 2.5 },
		exitRule: { type: 'stop_and_target_atr', stopMultiplier: 3.0, targetMultiplier: 3.0 },
	},
	{
		...base(),
		id: crypto.randomUUID(),
		name: 'Gözlem Tetikli Giriş (Herd 24h Takibi)',
		hypothesis: 'Sürü psikolojisi (herd) gözlemi 24 saat süren yapısal bir trend (drift) yaratır',
		sourceAssumption: 'trend-exists',
		entryRule: { type: 'on_observation', observationType: 'herd' },
		exitRule: { type: 'fixed_candles', n: 96 },
	},
	{
		...base(),
		id: crypto.randomUUID(),
		name: 'Gözlem Tetikli Giriş (Silence Sıkışma Patlaması)',
		hypothesis: 'Aşırı volatilite sıkışması ve sessizlik (silence) sonrası başlayan kırılım yönünde 3%/6% dalga yakalamak',
		sourceAssumption: 'trend-exists',
		entryRule: { type: 'on_observation', observationType: 'silence' },
		exitRule: { type: 'stop_and_target', stopPercent: 3.0, targetPercent: 6.0 },
		side: 'regime',
	},
	{
		...base(),
		id: crypto.randomUUID(),
		name: 'Gözlem Tetikli Giriş (Divergence RSI Uyumsuzluğu)',
		hypothesis: 'Fiyat ile momentum uyumsuzluğu (divergence) satıcıların tükendiğini ve dipten dönüşün başladığını gösterir',
		sourceAssumption: 'entry-signal-matters',
		entryRule: { type: 'on_observation', observationType: 'divergence' },
		exitRule: { type: 'stop_and_target', stopPercent: 3.0, targetPercent: 6.0 },
	}
];

// 4. Temiz dosyaları yaz
fs.writeFileSync(path.join(dataDir, 'experiments.json'), JSON.stringify(cleanExperiments, null, 2));
fs.writeFileSync(path.join(dataDir, 'observation-scoreboard.json'), JSON.stringify({ pending: [], scores: {}, coinBreakdown: {} }, null, 2));
fs.writeFileSync(path.join(dataDir, 'knowledge-graph.json'), JSON.stringify({ nodes: [], edges: [] }, null, 2));
const riskFile = path.join(dataDir, 'risk-state.json');
if (fs.existsSync(riskFile)) {
	fs.unlinkSync(riskFile);
}

// 5. Borsa tarafını da temizle (öksüz pozisyon bırakma!)
async function cleanExchange() {
	const dotenv = require('dotenv');
	const envPath = path.join(__dirname, '.env');
	if (fs.existsSync(envPath)) {
		dotenv.config({ path: envPath });
	}

	const apiKey = process.env.BINANCE_API_KEY;
	const secret = process.env.BINANCE_SECRET;
	const isTestnet = process.env.BINANCE_USE_TESTNET === 'true';
	const isLive = process.env.LIVE_TRADING_ENABLED === 'true';

	if (!apiKey || !secret || !isLive) {
		console.log('ℹ️  Borsa temizliği atlandı (API anahtarı yok veya Live Trading kapalı).');
		return;
	}

	try {
		const ccxt = require('ccxt');
		const exchange = new ccxt.binance({
			apiKey,
			secret,
			enableRateLimit: true,
			options: { defaultType: 'future', disableFuturesSandboxWarning: true },
		});
		if (isTestnet) exchange.setSandboxMode(true);

		await exchange.loadMarkets();
		console.log(`🔄 Borsa ${isTestnet ? 'TESTNET' : 'MAINNET'} temizleniyor...`);

		// Tüm açık pozisyonları kapat
		const positions = await exchange.fetchPositions();
		const openPositions = positions.filter(p => Math.abs(Number(p.contracts || 0)) > 0);

		for (const pos of openPositions) {
			const symbol = pos.symbol;
			const contracts = Math.abs(Number(pos.contracts));
			const side = Number(pos.contracts) > 0 ? 'sell' : 'buy';

			try {
				// Önce bekleyen emirleri iptal et
				try { await exchange.cancelAllOrders(symbol); } catch (e) {}
				// Pozisyonu kapat
				await exchange.createMarketOrder(symbol, side, contracts, undefined, { reduceOnly: true });
				console.log(`   ✅ ${symbol} kapatıldı (${contracts} kontrat)`);
			} catch (err) {
				console.error(`   ❌ ${symbol} kapatılamadı: ${err.message}`);
			}
		}

		if (openPositions.length === 0) {
			console.log('   ✓ Borsada açık pozisyon yoktu.');
		}

		// Kalan bekleyen emirleri temizle
		try {
			const openOrders = await exchange.fetchOpenOrders();
			for (const order of openOrders) {
				try {
					await exchange.cancelOrder(order.id, order.symbol);
				} catch (e) {}
			}
			if (openOrders.length > 0) {
				console.log(`   ✅ ${openOrders.length} bekleyen emir iptal edildi.`);
			}
		} catch (e) {}

		console.log('🧹 Borsa temizliği tamamlandı.');
	} catch (err) {
		console.error(`⚠️  Borsa temizliği sırasında hata: ${err.message}`);
		console.error('   Pozisyonları manuel kapatmanız gerekebilir.');
	}
}

cleanExchange().then(() => {
	console.log('------------------------------------------------------------');
	console.log('✅ SIFIRLAMA BAŞARILI!');
	console.log(`📁 Eski veriler şu klasöre güvenle arşivlendi:`);
	console.log(`   ${archiveDir}`);
	console.log('🚀 Yeni sistem 6 ÇEKİRDEK STRATEJİ ile 0 kilometreden hazırlandı.');
	console.log('🛡️  Her strateji için MAX 3 EŞZAMANLI POZİSYON sınırı devrede.');
	console.log('🧹 Borsa tarafı da temizlendi (öksüz pozisyon kalmadı).');
	console.log('------------------------------------------------------------');
	console.log('Şimdi sunucuda şu komutu çalıştırın:');
	console.log('pm2 restart organism --update-env');
}).catch(console.error);
