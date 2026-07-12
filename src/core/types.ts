// ============================================================================
// KRIPTOQUANT — Core Type Definitions
// ============================================================================
// Tüm modüller bu tipleri paylaşır. Tek kaynak noktası (Single Source of Truth).
// ============================================================================

/**
 * Tek bir mum çubuğunu temsil eder.
 * Binance API'den gelen veri bu formata dönüştürülür.
 */
export interface Candle {
	readonly openTime: number; // Unix timestamp (ms)
	readonly open: number;
	readonly high: number;
	readonly low: number;
	readonly close: number;
	readonly volume: number;
	readonly closeTime: number; // Unix timestamp (ms)
	readonly fundingRate?: number;
	readonly fundingPercentile?: number;
}

/**
 * Bir stratejinin ürettiği al/sat sinyali.
 */
export interface Signal {
	readonly timestamp: number; // Sinyalin üretildiği zaman (ms)
	readonly side: 'BUY' | 'SELL';
	readonly price: number; // Sinyalin üretildiği fiyat
	readonly confidence: number; // 0–1 arası güven skoru
	readonly reason: string; // İndikatör gerekçesi
	readonly stopLoss?: number; // Opsiyonel dinamik zarar kes seviyesi
	readonly takeProfit?: number; // Opsiyonel dinamik kar al seviyesi
	readonly metadata?: Record<string, number>; // İndikatör değerleri (ör. emaFast, emaSlow)
}

/**
 * Backtest sırasında simüle edilen bir emir.
 */
export interface Order {
	readonly timestamp: number;
	readonly side: 'BUY' | 'SELL';
	readonly price: number;
	readonly quantity: number;
	readonly value: number; // price * quantity
}

/**
 * Tamamlanmış bir işlem çifti (giriş + çıkış).
 */
export interface Trade {
	readonly asset: string;
	readonly entryOrder: Order;
	readonly exitOrder: Order;
	readonly positionSize: number; // USDT cinsinden pozisyon büyüklüğü
	readonly commission: number; // Toplam komisyon (giriş + çıkış)
	readonly grossPnl: number; // Komisyon öncesi kar/zarar
	readonly pnl: number; // Net kar/zarar (komisyon sonrası)
	readonly pnlPercent: number; // Net kar/zarar (yüzde)
	readonly holdingPeriod: number; // Pozisyon süresi (ms)
	readonly atrAtEntry: number; // Giriş anındaki ATR değeri
	readonly exitReason: string; // Çıkış nedeni
	readonly highestPrice?: number; // İşlem süresince görülen en yüksek fiyat
	readonly lowestPrice?: number; // İşlem süresince görülen en düşük fiyat
	readonly mae?: number; // Maximum Adverse Excursion (%)
	readonly mfe?: number; // Maximum Favorable Excursion (%)
}

/**
 * Backtest sonuç raporu.
 */
export interface BacktestResult {
	readonly strategyName: string;
	readonly coin: string;
	readonly interval: string;
	readonly startDate: string;
	readonly endDate: string;
	readonly initialCapital: number;
	readonly finalCapital: number;
	readonly totalReturn: number; // Yüzde
	readonly buyAndHoldReturn: number; // Buy & Hold getirisi (yüzde)
	readonly alpha: number; // Strategy Return - Buy & Hold Return
	readonly totalTrades: number;
	readonly winningTrades: number;
	readonly losingTrades: number;
	readonly rejectedSignals: number; // Filtre tarafından engellenen sinyal sayısı
	readonly winRate: number; // Yüzde
	readonly avgWin: number; // Ortalama kazanç (USDT)
	readonly avgLoss: number; // Ortalama kayıp (USDT)
	readonly maxDrawdown: number; // Yüzde
	readonly sharpeRatio: number;
	readonly sortinoRatio: number;
	readonly calmarRatio: number;
	readonly marRatio: number;
	readonly longestDrawdownDays: number;
	readonly timeUnderWaterPercent: number;
	readonly avgRecoveryTimeDays: number;
	readonly medianRecoveryTimeDays: number;
	readonly profitFactor: number;
	readonly trades: Trade[];
	readonly equityCurve: EquityPoint[];
	readonly filterStats?: import('../research/analytics/signal-analyzer.js').FilterStats;
	readonly analyzedSignals?: import('../research/analytics/signal-analyzer.js').AnalyzedSignal[];
	readonly regimeReport?: import('../research/regime/regime-analyzer.js').MarketRegimeReport;
	readonly analytics?: {
		readonly expectancyUsdt: number | string;
		readonly expectancyPercent: number | string;
		readonly expectancyR: number | string;
		readonly sqn: number | string;
		readonly kelly: number | string;
		readonly exposureTime: number;
		readonly capitalUsage: number;
		readonly recoveryFactor: number;
		readonly ulcerIndex: number;
		readonly marRatio: number;
		readonly gainPainRatio: number;
		readonly distributions: {
			readonly returns: number[];
			readonly durations: number[];
			readonly drawdowns: number[];
		};
	};
	readonly monteCarlo?: MonteCarloStats;
}

export interface MonteCarloStats {
	readonly method: 'bootstrap' | 'shuffle';
	readonly simulationsCount: number;
	readonly ruinThresholdPercent: number;
	readonly riskOfRuinPercent: number;
	readonly capitalQuantiles: {
		readonly worst: number;
		readonly p5: number;
		readonly p50: number;
		readonly p95: number;
		readonly best: number;
	};
	readonly drawdownQuantiles: {
		readonly p50: number;
		readonly p95: number;
		readonly worst: number;
	};
}

export interface PortfolioBacktestResult {
	readonly initialCapital: number;
	readonly finalCapital: number;
	readonly totalReturn: number;
	readonly maxDrawdown: number;
	readonly totalTrades: number;
	readonly winRate: number;
	readonly profitFactor: number;
	readonly trades: Trade[];
	readonly equityCurve: EquityPoint[];
}

/**
 * Equity curve üzerinde bir nokta.
 */
export interface EquityPoint {
	readonly timestamp: number; // UTC ms
	readonly equity: number; // Toplam portföy değeri (USDT)
	readonly drawdownPercent: number; // Zirveden düşüş yüzdesi
	readonly returnPercent: number; // Başlangıçtan itibaren getiri yüzdesi
}

/**
 * Her stratejinin uyması gereken sözleşme.
 * Yeni strateji = bu arayüzü implement etmek, başka bir şey değil.
 */
export interface Strategy {
	readonly name: string;
	readonly description: string;
	readonly warmupPeriod: number; // İndikatörlerin sağlıklı hesaplanması için gereken minimum mum sayısı
	evaluate(candles: Candle[]): Signal[];
}

/**
 * Risk yönetimi konfigürasyonu.
 */
export interface RiskConfig {
	readonly maxPositionPercent: number; // Tek coin için maks. portföy yüzdesi
	readonly maxDailyLossPercent: number; // Günlük maks. kayıp yüzdesi
	readonly maxOrderValue: number; // Tek emrin maks. değeri (USDT)
	readonly stopLossAtrMultiplier: number; // Stop-loss = Entry Price - (ATR × multiplier)
	readonly enableFundingFilter?: boolean; // Funding filtresi aktif mi?
	readonly fundingPercentileThreshold?: number; // Veto eşiği (ör. 0.95 = en yüksek %5)
}

/**
 * Genel platform konfigürasyonu.
 */
export interface PlatformConfig {
	readonly coins: string[]; // İzlenen coin sembolleri (ör. "BTCUSDT")
	readonly defaultInterval: string; // Varsayılan mum aralığı (ör. "1d")
	readonly initialCapital: number; // Başlangıç sermayesi (USDT)
	readonly commissionPercent: number; // İşlem komisyonu (ör. 0.10 = %0.10)
	readonly slippagePercent: number; // Kayma (ör. 0.05 = %0.05)
}

/**
 * Filtre motoru konfigürasyonu.
 */
export interface FilterConfig {
	readonly adxPeriod: number;
	readonly adxVetoThreshold: number;
	readonly rvolLookback: number;
	readonly rvolVetoThreshold: number;
}

/**
 * Güven motoru konfigürasyonu.
 */
export interface ConfidenceConfig {
	readonly baseScore: number;
	readonly adxStrongThreshold: number;
	readonly adxStrongBonus: number;
	readonly rvolHighThreshold: number;
	readonly rvolHighBonus: number;
	readonly minimumScore: number;
}

/**
 * strategy-defaults.json yapısı.
 */
export interface StrategyDefaultsConfig {
	readonly strategies: {
		readonly emaCross: { readonly fast: number; readonly slow: number };
		readonly smaCross: { readonly fast: number; readonly slow: number };
	};
	readonly filters: FilterConfig;
	readonly confidence: ConfidenceConfig;
}

/**
 * Binance API'den dönen ham mum verisi (klines).
 * Bu tip sadece data/ katmanında kullanılır, dışarıya Candle olarak çıkar.
 */
export type BinanceKline = [
	number, // Open time
	string, // Open
	string, // High
	string, // Low
	string, // Close
	string, // Volume
	number, // Close time
	string, // Quote asset volume
	number, // Number of trades
	string, // Taker buy base volume
	string, // Taker buy quote volume
	string, // Ignore
];
