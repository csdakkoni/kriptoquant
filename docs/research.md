# Araştırma ve Doğrulama Laboratuvarı

KriptoQuant platformu, stratejilerin aşırı uyum (overfitting) ve tesadüfi karlar üretmesini engellemek için kurumsal standartlarda doğrulama (validation) araçlarına sahiptir.

## Araştırma Akış Şeması

```
Strateji Fikri ──→ Backtest ──→ Parameter Sweep ──→ Walk-Forward ──→ Rolling WF ──→ Multi-Asset Cross Val
```

## Doğrulama Araçları

### 1. Parameter Sweep (Parametre Taraması)
Stratejinin parametre uzayındaki tüm kombinasyonları paralel olarak test eder. En iyi kar getiren kombinasyonu belirler. Ancak tek başına parametre sweep overfitting riski taşır.

### 2. Walk-Forward Validation
Veri setini **Train** ve **Test** (In-Sample / Out-of-Sample) olarak böler:
- Parametre sweep sadece **Train** setinde yapılır.
- Train setindeki en başarılı kombinasyon, hiç görmediği **Test** verisinde test edilir.
- Böylece stratejinin gelecekteki verilerde çalışıp çalışmayacağı tarafsız bir şekilde ölçülür.

### 3. Rolling Walk-Forward (Çoklu Pencereli Doğrulama)
Veriyi tek bir pencere yerine zaman içinde kayan (rolling) **N adet pencereye** böler.
- Her pencere kendi içinde Train/Test aşamalarından geçer.
- Amaç: Stratejinin farklı piyasa koşullarında (boğa, ayı, yatay) tutarlı çalışıp çalışmadığını ölçmektir.
- Pencerelerden elde edilen geçiş oranları, Sharpe oranlarının dengesi ve drawdown değerleri üzerinden **Robustness Score (0-100)** hesaplanır.

### 4. Multi-Asset Cross-Validation (Çapraz Varlık Laboratuvarı)
Stratejiyi birden çok kripto varlık (BTC, ETH, SOL, BNB, XRP) ve zaman dilimi (1h, 4h, 12h, 1d) üzerinde test ederek **Cross-Asset Robustness Score** hesaplar.
- Tek bir varlığa aşırı uyum sağlamış (overfitted) stratejiler bu katmanda elenir.
- Kararlılık ağırlıkları `config/robustness.json` dosyasından okunur.
- Grid raporu terminalde ve JSON/CSV çıktılarında gösterilir.
