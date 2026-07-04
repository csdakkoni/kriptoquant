# KriptoQuant Sistem Mimarisi

KriptoQuant, profesyonel bir kantitatif araştırma ve işlem platformudur. Modüler ve katmanlı yapısı sayesinde veri kaynağı (backtest, paper, canlı) ve aracı kurum (simüle, borsa) bağımsız şekilde çalışır.

## Katmanlı Mimari Şeması

```
[ Market Data ] ──→ Strategy (Saf Sinyal)
                        │
                        ▼
                  Filter Engine (Filtreleme)
                        │
                        ▼
                  Confidence Engine (Güven Skoru)
                        │
                        ▼
                  Risk Engine (Risk Onayı ve Pozisyon Büyüklüğü)
                        │
                        ▼
                  Execution Engine (Orkestrasyon)
                        │
                  ┌─────┴─────┐
                  ▼           ▼
           Portfolio    Broker Interface (Emir Uygulama)
          (Pozisyon)          │
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
           SimulatedBroker  PaperBroker  BinanceBroker
```

## Temel Modüller ve Sorumlulukları

### 1. Market Data Katmanı (`src/data/`)
Piyasadan mum verilerini sağlar. `MarketDataProvider` arayüzü sayesinde veri kaynağı soyutlanmıştır:
- **`CSVProvider`**: Dosyadan tarihsel veri yükler.
- **`ReplayProvider`**: Tarihsel verileri canlı yayın gibi tek tek akıtarak paper trading simülasyonu yapmayı sağlar.
- **`BinanceWebSocketProvider` (Sprint 15+)**: Canlı WebSocket verisini dinler.

### 2. Araştırma ve Sinyal Katmanı (`src/research/`)
Stratejiler sadece veri alıp saf `Signal` üretmekle sorumludur. İndikatör hesaplamaları buradaki saf fonksiyonlar aracılığıyla yürütülür.
- **Filter Engine**: Sinyalleri trend gücü (ADX) ve hacim (RVOL) filtrelerinden geçirerek veto edebilir.
- **Confidence Engine**: Sinyallerin indikatör puanlarına göre 0-100 arası bir güven skoru üretir. Skoru minimum sınırın altındaki sinyaller elenir.

### 3. Risk Yönetimi (`src/core/risk/`)
`evaluateRisk` fonksiyonu portföy bakiyesi ve günlük P&L durumuna göre emri onaylar, reddeder veya pozisyon büyüklüğünü sınırlar. Veto yetkisine sahiptir.

### 4. İşlem Yönetimi ve Yürütme (`src/execution/`)
- **`ExecutionEngine`**: Tüm akışı (Stop-loss kontrolü, sinyal tetikleme, risk onayı, broker emri) koordine eden ana orkestrasyon merkezidir.
- **`PositionManager`**: Açık pozisyon bilgilerini (`highestPrice`, `lowestPrice`, `stopLossPrice`) tutar ve işlem içi MAE/MFE takibini yapar.
- **`Portfolio`**: Portföyün nakit bakiyesi, net getirisi ve equity curve zaman serisi metriklerini yönetir.
- **`Broker`**: Saf emir iletim katmanıdır. `buy()` veya `sell()` fonksiyonlarını çalıştırıp komisyon ve kaymayı (slippage) uygulayarak `Fill` objesi döner.
- **`TradeLogger`**: İşlem loglarını aracı kurumdan bağımsız olarak dosyaya yazan persistence katmanıdır.
