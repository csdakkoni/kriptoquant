# KriptoQuant Hızlı Başlangıç Rehberi (Quick Start Guide)

KriptoQuant, birden çok kripto varlığı birleşik sermaye ve risk kurallarıyla test eden, istatistiksel geçerlilik testlerinden geçiren (Walk-Forward, Monte Carlo) ve Alpha stratejilerini otomatik keşfeden profesyonel bir **Quant Research Operating System** platformudur.

---

## 🚀 1. Kurulum ve Gereksinimler

Projenin çalışması için bilgisayarınızda **Node.js (v18+)** kurulu olmalıdır.

```bash
# Bağımlılıkları yükleyin
npm install
```

---

## 📈 2. İlk Adımlar

### A) Tarihsel Verileri Çekme
Platformun çalışabilmesi için tarihsel mum (candle) verilerine ihtiyaç vardır. CLI aracıyla Binance spot piyasasından veri çekebilirsiniz:

```bash
# BTCUSDT için günlük (1d) verileri çekip kaydet
npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d

# ETHUSDT için günlük (1d) verileri çekip kaydet
npx tsx src/cli.ts fetch --coin ETHUSDT --interval 1d
```
Veriler `data/raw/` dizini altına JSON formatında kaydedilir.

### B) İlk Backtest'i Çalıştırma
Platformda tanımlı dahili stratejilerden biriyle (örneğin `ema-cross` veya `donchian-breakout`) hızlı bir test yapabilirsiniz:

```bash
# BTCUSDT üzerinde günlük periyotta EMA Cross stratejisini çalıştır
npx tsx src/cli.ts backtest --strategy ema-cross --coin BTCUSDT --interval 1d
```

### C) JSON Dosyası Üzerinden Özel Strateji Çalıştırma
Strategy Factory (JSON AST) sayesinde kod yazmadan kendi stratejinizi JSON formatında tanımlayabilirsiniz.

`examples/ema_cross.json` dosyasını çalıştıralım:
```bash
npx tsx src/cli.ts backtest-config --config examples/ema_cross.json --coin BTCUSDT --interval 1d
```

---

## 🔬 3. Bilimsel Doğrulama (Research Workflow)

Stratejinin geçmişe aşırı uyum (overfitting) göstermesini engellemek ve gelecek performansını simüle etmek için Walk-Forward testini çalıştırın:

```bash
# Walk-Forward Validation (3 pencereli, %70 Train / %30 Test)
npx tsx src/cli.ts walkforward --strategy ema-cross --coin BTCUSDT --interval 1d
```

---

## 💼 4. Portföy Simülasyonu (Portfolio Engine)

Birden çok varlığı aynı anda ortak nakit ve risk limitleriyle test etmek için portföy backtest komutunu kullanın:

```bash
# BTC ve ETH üzerinde Risk Budget sermaye dağıtıcısı ve %1 işlem riskiyle portföy testi
npx tsx src/cli.ts portfolio-backtest --strategy ema-cross --coins BTCUSDT,ETHUSDT --interval 1d --allocation risk-budget --risk-percent 1.0
```

---

## 🏆 5. Alpha Keşfi (Alpha Discovery)

Belirlediğiniz indikatör havuzundan rastgele adaylar oluşturup çok aşamalı doğrulama boru hattından (Quick Backtest ➔ Min Trade ➔ Multi Asset ➔ Monte Carlo) geçiren ve Pareto optimal stratejileri bulup kaydeden keşif aracını çalıştırın:

```bash
npx tsx src/cli.ts alpha-discover --coins BTCUSDT,ETHUSDT --candidates 20 --interval 1d
```
Keşfedilen en iyi strateji konfigürasyonları otomatik olarak `results/alpha/` dizinine kaydedilir.
