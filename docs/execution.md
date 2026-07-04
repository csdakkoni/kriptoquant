# Yürütme ve Portföy Mimarisi (Execution Layer)

KriptoQuant yürütme katmanı, strateji sinyallerinin emre dönüştürülmesi, stop-loss takibi ve hesap durumunun yönetilmesi süreçlerini yürütür.

## Sorumlulukların Ayrılması (Separation of Concerns)

Mimari, Domain-Driven Design (DDD) prensiplerine uygun olarak tasarlanmıştır:

### 1. PositionManager (`src/execution/position-manager.ts`)
Açık pozisyonun durumunu tutan aggregate nesnedir:
- İşlem içi en yüksek (`highestPrice`) ve en düşük (`lowestPrice`) fiyatları takip eder.
- Pozisyon kapatıldığında bu fiyatlar üzerinden **MAE (Maximum Adverse Excursion)** ve **MFE (Maximum Favorable Excursion)** değerlerini hesaplar.
- Pozisyon büyüklüğü, stop fiyatı ve işlem süresi limitlerini sorgular.

### 2. StopRule (`src/execution/stop-rule.ts`)
Stop-loss kararlarını veren modüler kurallar arayüzüdür:
- `AtrStopRule`: Fiyatın en son mumdaki ATR (Average True Range) çarpanı kadar altına stop seviyesi koyar.
- Arayüz (`StopRule`) sayesinde gelecekte Chandelier Exit, Trailing Stop gibi kurallar drop-in olarak sisteme eklenebilir.

### 3. Portfolio (`src/execution/portfolio.ts`)
Genel hesap ve bakiye durumunu yönetir:
- Nakit bakiye (`capital`) ve başlangıç sermayesini takip eder.
- Mum bazlı varlık değerini (`recordEquityPoint`) kaydeder.
- Drawdown ve getiri istatistiklerini hesaplar.
- Tamamlanan trade geçmişini saklar.

### 4. Broker (`src/execution/broker.ts`)
Borsaya veya simülasyona emir ileten aracı kurum soyutlamasıdır:
- `buy()` ve `sell()` metodlarını içerir.
- Geriye gerçekleşme fiyatını içeren `Fill` döner.
- `SimulatedBroker`: Backtest için deterministik komisyon ve kayma (slippage) uygular.
- `PaperBroker`: Paper trading için saf emri iletir.

### 5. TradeLogger (`src/execution/trade-logger.ts`)
İşlem ve fill geçmişinin persistence katmanıdır:
- Broker'dan tamamen bağımsızdır.
- `CSVTradeLogger`: İşlemleri CSV dosyasına loglar.
- Gelecekte DuckDB, SQLite veya Kafka veri aktarımları bu arayüz üzerinden broker değiştirilmeden yapılabilir.
