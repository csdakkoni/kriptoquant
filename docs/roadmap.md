# KriptoQuant Geliştirme Yol Haritası (Roadmap)

KriptoQuant, aşama aşama kurumsal seviyede bir doğrulama ve yürütme platformuna evrilmektedir. Gelecek sprintlerin planı ve hedefleri aşağıdadır:

---

## 🚀 Sprint 15 — Market Regime Detection (Piyasa Rejimi Tespiti)

**Amaç**: Stratejinin hangi piyasa rejimlerinde (Trend, Yatay Testere, Yüksek Oynaklık, Düşük Oynaklık) kar ettiğini ve hangilerinde para kaybettiğini belirlemek.

- **Rejim Sınıflandırıcılar**: ADX, ATR ve RSI tabanlı basit rejim tespit algoritmaları.
- **Rejim Bazlı Analiz**:
  - Trend piyasasındaki getiri ve başarı oranı.
  - Yatay piyasadaki (testerede) drawdown ve kayıplar.
- **Dinamik Filtre Entegrasyonu**: Rejime göre otomatik devreye giren filtre kuralları.

---

## 🎲 Sprint 16 — Monte Carlo Simulation & Risk Lab

**Amaç**: Elde edilen trade dağılımlarını karıştırıp (resampling) binlerce simülasyon yaratarak portföyün iflas riskini ve en kötü durum drawdown'ını ölçmek.

- **Resampling Engine**: Trade getirilerinin bootstrap yöntemiyle karıştırılması.
- **Risk Ölçümleri**:
  - **Risk of Ruin (İflas Riski %)**
  - **95% Confidence Interval Drawdown** (Güven aralığında en kötü drawdown)
  - Ortalama toparlanma süresi olasılık dağılımları.

---

## ⚖️ Sprint 17 — Portfolio Construction & Allocation Engine

**Amaç**: Çoklu varlık ve çoklu strateji portföyünü oluşturup, optimal ağırlıklandırma (allocation) modellerini entegre etmek.

- **Modeller**:
  - Equal Weight (Eşit Ağırlık)
  - Risk Parity (Risk Eşitliği)
  - Minimum Variance (Minimum Varyans)
- **Korelasyon Matrisi (Correlation Matrix)**: Varlıklar arası korelasyonların hesaplanması.
- **Çoklu Varlık Backtest Orkestrasyonu**: Aynı anda BTC, ETH ve SOL taşıyan birleşik portföy simülasyonu.

---

## 📡 Sprint 18 — Binance WebSocket & Live Paper Trading

**Amaç**: Gerçek zamanlı WebSocket bağlantısı ile PaperBroker'ı canlı verilere bağlamak.

- **WebSocket Adapter**: Binance ticker ve kline websocket kanallarının bağlanması.
- **Event-Driven Loop**: Canlı gelen her mum kapatıldığında Execution Engine'in tetiklenmesi.
- **Live Paper Trading**: Gerçek zamanlı simüle işlemler ve live trade logging.

---

## 💰 Sprint 19 — Live Trading & Binance Order Adapter

**Amaç**: Canlı emir iletimini Binance API üzerinden sağlayarak gerçek parayla işlemleri başlatmak.

- **BinanceBroker**: API anahtarlarıyla gerçek Spot/Futures emirlerinin (BUY/SELL MARKET) gönderilmesi.
- **Hata Toleransı (Fault Tolerance)**: WebSocket kopmaları, rate limitler ve bakiye yetersizliği kontrolleri.
- **Live Dashboard**: Canlı P&L, pozisyonlar ve trade journal izleme ekranı.
