# Changelog

All notable changes to the **KriptoQuant** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-07-13 — Canlı Motor Overhaul

### Changed (Breaking)
- **Canlı motor backtest ile hizalandı**: Strateji-özel gizli kâr-kilitleme katmanı (breakeven/+1%/+2% kademeleri, genel trailing stop) tamamen kaldırıldı. Çıkışlar artık yalnızca SL / TP / karşıt sinyal ile yapılır — backtest motoruyla aynı kural yapısı.
- **Gerçekçi dolumlar**: SL tetiklendiğinde stop fiyatından değil, gözlenen tik fiyatından satılır. Trailing stop'taki `Math.max(price, floor)` hayali dolumu kaldırıldı.
- **Canlı kadro 5 stratejiye indirildi**: `a2-v2`, `vwap-reversion` (mean reversion, 15m), `donchian-breakout`, `ema-cross` (trend, 4h), `random` (bilimsel baseline). Trend stratejileri için varsayılan TP kaldırıldı (karşıt sinyalle çıkış); SL yoksa backtest ile aynı `2×ATR` kuralı uygulanır.
- **Pozisyon boyutlandırma dürüstleştirildi**: `risk.json` üzerinden `riskPerTradePercent` (0.5%), `maxPositionPercent` (15%), `maxOrderValue`, `maxConcurrentPositions` (4) uygulanır; log gerçek riski yazar.

### Added
- **Günlük zarar kill-switch**: Gün içi equity düşüşü `maxDailyLossPercent`'i (%3) aşarsa gün sonuna kadar yeni giriş açılmaz (açık pozisyonlar SL/TP/sinyalle yönetilmeye devam eder).
- **BTC rejim filtresi**: BTC 4h kapanışı 200-SMA altındayken (RISK_OFF) yeni long girişleri engellenir. `risk.json > enableBtcRegimeFilter` ile kapatılabilir.
- **Restart gap koruması**: Motor kapalıyken stop seviyesi delinmiş pozisyonlar açılışta mevcut fiyattan tasfiye edilir.
- Yeni birim testleri: gerçekçi SL dolumu ve kill-switch davranışı.

### Removed
- **Sahte ML katmanı**: `MetaLabeler` veto akışı ve hiç çağrılmayan `OnlineLearner` canlı motordan söküldü; UI'daki "ML Veto" kutusu kaldırıldı (yanıltıcı "SGD & Platt Scaling" logları dahil).
- Çöp stratejiler silindi: `a1`, `freedom`, `freedom_b`, `gemini_1`, `gemini_2`, `trend-pullback`, `bollinger-bands-timestamp`.
- Repo temizliği: `kriptoquant.tar.gz`, `kriptoquant_all_source_code.txt` silindi.

### Security
- **Sahte dolum fallback'i kaldırıldı**: Gerçek para modunda emir başarısız olursa artık sessizce paper dolum simüle edilmez; hata fırlatılır, alımlar atlanır, satışlar sonraki tikte tekrar denenir.
- `config/keys.json` git takibinden çıkarıldı ve `.gitignore`'a eklendi; şablon olarak `config/keys.example.json` eklendi.

---

## [1.0.0-rc1] - 2026-07-04

### Added
- **E2E Verification**: Added `verify-e2e` CLI command to orchestrate the entire validation workflow (Backtest ➔ Walk-Forward ➔ Multi-Asset ➔ Monte Carlo ➔ Portfolio ➔ Alpha Discovery) with dynamic assertions.
- **Performance Benchmarking**: Created `tests/benchmark.ts` to profile execution speeds and memory profiles across 10k, 100k, and 500k candle charts.
- **Comprehensive Docs**: Written detailed user guides covering Quickstart, CLI Reference, Strategy DSL schemas, Portfolio Engine internals, and Scientific Research Workflows.
- **MIT License**: Included formal project licensing file.
- **Examples**: Cleaned up project examples folder with a script and JSON DSL configurations.

---

## [0.19.0] - 2026-07-04

### Added
- **Alpha Discovery Orchestrator**: Added sequential validation checkpoints to skip Monte Carlo processing on underperforming configs.
- **Composite Alpha Scoring**: Implemented detailed scorecard metrics (`profitability`, `risk`, `consistency`, `regimeCoverage`, `robustness`).
- **Pareto Front Filtrations**: Calculated multi-objective non-dominated solutions across Return, Drawdown, and Sharpe ratios.
- **DiscoveryWorker**: Decoupled asynchronous worker structure ready for parallel worker thread threads scaling.

---

## [0.18.0] - 2026-07-04

### Added
- **Portfolio Execution Engine**: Multi-position backtest simulation across aligned chronologies.
- **CSVTimelineProvider**: Aligned different asset histories by chronological timestamp groups.
- **AllocationStrategy Pattern**: Equal Weight and dynamically adjusted ATR Risk Budgeting models.
- **PositionBook Account Book**: Centralized active position manager tracking real-time drawdowns and stop executions.

---

## [0.17.0] - 2026-07-03

### Added
- **Monte Carlo Simulator**: Sequence and Bootstrap simulations analyzing sequence risks.
- **Risk of Ruin Calculations**: Quantified account collapse risks at custom drawdown thresholds.

---

## [0.16.0] - 2026-07-03

### Added
- **Strategy Factory**: Programmatic AST parser translating JSON configurations into executable strategy functions.

---

## [0.15.0] - 2026-07-02

### Added
- **Market Regime Detection**: Classifying four primary regimes (Up/Down trends combined with High/Low volatilities).

---

## [0.11.0] - [0.14.0] - 2026-06-28 to 2026-07-01

### Added
- **Walk-Forward Validation**: Multi-window train/test periods preventing future data leakages.
- **Multi-Asset Validation**: Multi-coin cross-validations.
- **Execution Engine**: Re-architected broker, portfolio, and trade loggers.
