# KriptoQuant CLI Referans Dokümanı

KriptoQuant CLI aracı (`src/cli.ts`), quant araştırma iş akışındaki tüm süreçleri terminal üzerinden yönetmenizi sağlar.

---

## 🛠️ CLI Komutları

### 1. `fetch`
Binance REST API üzerinden seçilen coin ve zaman aralığı için tarihsel mum (bar) verilerini çeker ve `data/raw/` dizinine kaydeder.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts fetch --coin <coin_name> --interval <interval>
  ```
- **Seçenekler**:
  - `--coin`: Çekilecek sembol (Varsayılan: `BTCUSDT`).
  - `--interval`: Zaman aralığı (`1d`, `4h`, `1h`, `15m`).

---

### 2. `backtest`
Tek bir varlık üzerinde dahili TypeScript stratejisiyle backtest ve Monte Carlo risk simülasyonu çalıştırır.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts backtest --strategy <strategy_name> --coin <coin_name> --interval <interval> [mc_options]
  ```
- **Seçenekler**:
  - `--strategy`: Çalıştırılacak strateji (`ema-cross`, `donchian-breakout`, `rsi-mean-reversion`).
  - `--simulations`: Monte Carlo simülasyon adedi (Varsayılan: `1000`).
  - `--mc-method`: Monte Carlo yöntemi (`bootstrap` veya `shuffle`).
  - `--ruin-pct`: Risk of Ruin çöküş eşiği (Varsayılan: `30` -> %30 hesap kaybı).

---

### 3. `backtest-config`
JSON formatındaki Strategy Factory konfigürasyon dosyalarını kullanarak tek varlık üzerinde backtest çalıştırır.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts backtest-config --config <path_to_json> --coin <coin_name> --interval <interval>
  ```
- **Seçenekler**:
  - `--config`: Çalıştırılacak JSON strateji dosyasının tam yolu.

---

### 4. `portfolio-backtest`
Çoklu varlık üzerinde birleşik sermaye ve risk limitleriyle portföy simülasyonu çalıştırır.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts portfolio-backtest --strategy <strategy> --coins <coin_list> --interval <interval> [portfolio_options]
  ```
- **Seçenekler**:
  - `--coins`: Virgülle ayrılmış sembol listesi (Ör. `BTCUSDT,ETHUSDT,SOLUSDT`).
  - `--allocation`: Bütçe dağıtıcı strateji (`equal` veya `risk-budget`).
  - `--risk-percent`: Risk Budget kullanıldığında işlem başına maksimum portföy risk oranı (Varsayılan: `1.0` -> %1).
  - `--max-positions`: Portföyde aynı anda açık olabilecek maksimum pozisyon limiti (Varsayılan: `5`).

---

### 5. `walkforward`
Belirlenen stratejinin parametre kombinasyonlarını geçmiş veride tarar, en başarılı parametreleri test bölgesinde çalıştırarak overfitting analizi yapar.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts walkforward --strategy <strategy> --coin <coin> --interval <interval>
  ```

---

### 6. `walkforward-rolling`
Çoklu kayan pencere (Rolling Window) kullanarak Walk-Forward doğrulaması gerçekleştirir. Robustness Score (0-100) ve tutarlılık etiketleri üretir.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts walkforward-rolling --strategy <strategy> --coin <coin> --interval <interval>
  ```

---

### 7. `walkforward-multi`
Çoklu varlıklar ve farklı zaman aralıkları üzerinde Walk-Forward doğrulamasını eşzamanlı çalıştırır.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts walkforward-multi --strategy <strategy> --coins <coin_list> --intervals <interval_list>
  ```

---

### 8. `alpha-discover`
Otomatik strateji jeneratörü ile rastgele adaylar oluşturup çok aşamalı doğrulama zincirlerinden geçirerek en başarılı stratejileri ve Pareto optimal kümesini bulur.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts alpha-discover --coins <coin_list> --candidates <number_of_candidates> --interval <interval>
  ```
- **Seçenekler**:
  - `--candidates`: Üretilecek ve elenecek aday strateji sayısı (Varsayılan: `20`).

---

### 9. `verify-e2e`
Platformun tüm modüllerinin (backtest, portfolio, walk-forward, multi-asset, monte carlo, alpha discovery) entegrasyonunu uçtan uca otomatik test eder.
- **Kullanım**:
  ```bash
  npx tsx src/cli.ts verify-e2e
  ```
