# KriptoQuant — Professional Crypto Quant Research Platform (v1.0.0-rc1)

KriptoQuant; tek varlık kısıtlarını aşarak, birden fazla kripto parayı ortak bakiye ve risk kurallarıyla simüle eden, gelişmiş istatistiksel doğrulama yöntemleriyle (Walk-Forward, Monte Carlo) overfitting (aşırı uyum) analizi yapan ve otomatik alpha stratejisi keşfeden kurumsal düzeyde bir **TypeScript Quant Araştırma Platformudur**.

---

## 🏗️ Platform Mimarisi

KriptoQuant modüler bir yapıda, "Research Operating System" vizyonuyla inşa edilmiştir:

```
                              [ User Config / DSL ]
                                        │
                                        ▼
                                [ Strategy Factory ]
                                        │
                                        ▼
                              [ Execution Engine ]
                                        │
                                        ▼
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
               [ Research Lab ]               [ Portfolio Engine ]
             - Walk-Forward Sweep           - Timeline Alignment
             - Rolling WF Robustness        - Position Book (Stops)
             - Multi-Asset validation       - Equal/Risk Allocation
             - Monte Carlo Stress           - Advanced Analytics
             - Alpha Discovery
```

---

## ⚡ Temel Yetenekler & Özellikler

1. **Strategy Factory (JSON AST)**: Kod yazmadan, JSON konfigürasyonları ve mantıksal expressions (AND, OR, >, <, cross-above/below) kullanarak dinamik stratejiler inşa edin.
2. **Portfolio Yürütme Motoru**: `CSVTimelineProvider` ile farklı varlıkları kronolojik olarak hizalayın, `PositionBook` ile stop-loss ve slot devirlerini yönetin.
3. **Dinamik Sermaye Dağıtımı**: Eşit ağırlıklı (`EqualWeight`) veya ATR tabanlı dinamik portföy riski sınırlandırmalı (`RiskBudget`) bütçeleme yapın.
4. **Walk-Forward Robustness Lab**: Kayan pencereli (Rolling Window) analizlerle stratejilerin gelecek başarısını simüle edin ve Robustness Skoru (0-100) üretin.
5. **Monte Carlo Stres Testi**: Bootstrap ve Shuffle yöntemleriyle 1000'den fazla yapay sermaye eğrisi oluşturun, **Risk of Ruin (İflas Riski)** oranını ölçün.
6. **Alpha Discovery Engine**: Belirlenen bileşenlerden rastgele stratejiler türetip kontrol noktalarından geçiren ve **Pareto Optimal** (Return vs Drawdown vs Sharpe) alpha'ları bulan keşif motoru.
7. **End-to-End Entegrasyon**: `verify-e2e` aracıyla tüm modülleri tek tuşla otomatik test edin ve doğrulayın.

---

## 🚀 Hızlı Başlangıç

### Bağımlılıkları Yükleme
```bash
npm install
```

### Veri Çekme (Binance Spot)
```bash
npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d
npx tsx src/cli.ts fetch --coin ETHUSDT --interval 1d
```

### Özel JSON Stratejisi ile Backtest & Monte Carlo
```bash
npx tsx src/cli.ts backtest-config --config examples/ema_cross.json --coin BTCUSDT --interval 1d
```

### Çoklu Varlık Portföy Backtest (Risk Bütçeli)
```bash
npx tsx src/cli.ts portfolio-backtest --strategy ema-cross --coins BTCUSDT,ETHUSDT --interval 1d --allocation risk-budget --risk-percent 1.5 --max-positions 2
```

### Alpha Keşif Motoru (Alpha Discovery)
```bash
npx tsx src/cli.ts alpha-discover --coins BTCUSDT,ETHUSDT --candidates 50 --interval 1d
```

### Uçtan Uca Doğrulama
```bash
npx tsx src/cli.ts verify-e2e
```

---

## 📚 Kapsamlı Dokümantasyon (`docs/`)

Detaylı kullanım rehberleri ve mimari detaylar için `docs/` klasörüne başvurun:
- [QUICKSTART.md](file:///Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant/docs/QUICKSTART.md): Kurulum ve ilk çalıştırma adımları.
- [CLI_REFERENCE.md](file:///Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant/docs/CLI_REFERENCE.md): Tüm terminal komutları ve argümanlar.
- [STRATEGY_DSL.md](file:///Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant/docs/STRATEGY_DSL.md): JSON DSL Strategy Factory yazım kuralları.
- [PORTFOLIO_ENGINE.md](file:///Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant/docs/PORTFOLIO_ENGINE.md): Portföy yürütme ve sermaye dağıtım kuralları.
- [RESEARCH_WORKFLOW.md](file:///Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant/docs/RESEARCH_WORKFLOW.md): Bilimsel araştırma adımları.

---

## 🔬 Performans Değerleri (Benchmark)

`tests/benchmark.ts` testi sonuçlarına göre platformun 1300 yıllık günlük veriye (500.000 mum) tekabül eden yük performansı:
- **Veri Üretimi + İndikatör Hesaplama + Backtest + 1000 Simülasyon Monte Carlo**: `< 850 ms`
- **Çoklu Varlık Portföy Yürütme (Alignment & Execution)**: `~ 55 sn`
- **Bellek Kullanımı (Heap)**: `< 306 MB`
- **164/164 birim test** başarıyla geçmektedir (`npx vitest run`).

---

## 📄 Lisans

Bu proje **MIT Lisansı** altında lisanslanmıştır. Detaylar için [LICENSE](file:///Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant/LICENSE) dosyasına göz atabilirsiniz.
