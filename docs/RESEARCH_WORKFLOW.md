# KriptoQuant Research Workflow & Robustness Lab

KriptoQuant, bir stratejinin geçmişe aşırı uydurulmasını (overfitting) bilimsel yöntemlerle engellemek ve gerçek hayattaki tutarlılığını ölçmek üzere tasarlanmış çok aşamalı bir doğrulama laboratuvarı sunar.

---

## 🔬 Doğrulama Aşamaları (Validation Chain)

İdeal bir quant araştırma iş akışı şu adımlardan oluşur:

```
            [ 1. Parameter Sweep ]
     (Tarihsel parametre uzayını tarama)
                      │
                      ▼
        [ 2. Walk-Forward Validation ]
   (Veriyi Train/Test bölüp sızıntıyı önleme)
                      │
                      ▼
        [ 3. Rolling Walk-Forward ]
  (Çoklu pencerelerde Robustness Score hesabı)
                      │
                      ▼
         [ 4. Monte Carlo Stres Testi ]
   (İşlem sırasını bozarak iflas riski ölçümü)
                      │
                      ▼
         [ 5. Market Regime Analysis ]
   (Trend/Yatay piyasa rejimlerindeki başarı)
```

---

## 📅 1. Walk-Forward Validation (WFA)
Tarihsel veride en iyi sonucu veren parametre setinin gelecekte de çalışacağını varsaymak en büyük hatadır. WFA bunu engellemek için veriyi ikiye ayırır:
- **Train Bölgesi (%70)**: Strateji parametreleri (ör. EMA periyotları) taranır ve en yüksek getiriyi/Sharpe oranını veren parametre seçilir.
- **Test Bölgesi (%30)**: Seçilen "en iyi" parametre seti, stratejinin daha önce hiç görmediği Test verisi üzerinde tek seferlik çalıştırılır.
Gelecekteki performans, Test bölgesindeki gerçek sonuçlarla ölçülür.

---

## 🌀 2. Rolling Walk-Forward (Kayan Pencereler)
Stratejinin tek bir dönemde şans eseri başarılı olmasını engellemek için veri $N$ adet kayan pencereye bölünür.
- Her pencere kendi içinde bağımsız Train ve Test bölgeleri içerir.
- Test bölgeleri kronolojik olarak birbirini takip eder ve asla üst üste binmez (no overlap).
- Sonuçta **Robustness Score (0-100)** hesaplanır:
  - **>= 70**: 🟢 ROBUST (Farklı dönemlerde tutarlı başarı)
  - **>= 50**: 🟡 MODERATE (Orta seviye tutarlılık)
  - **< 30**: 🔴 UNRELIABLE (Aşırı uyum göstermiş, güvensiz)

---

## 🎲 3. Monte Carlo Stres Testi
Geriye dönük testlerde işlemlerin sırası sabittir. Ancak gelecekte ardışık kayıplar (Drawdown) farklı sıralarda gelecektir. Monte Carlo simülatörü bunu iki yöntemle test eder:
1. **Bootstrap Yöntemi**: İşlemler yedekli rastgele seçilerek 1000 farklı yapay sermaye eğrisi (path) çizilir.
2. **Shuffle Yöntemi**: Mevcut işlemlerin sadece sırası karıştırılarak sequence risk ölçülür.
Simülasyon sonunda **Risk of Ruin (İflas Olasılığı)** hesaplanır. Eğer hedeflenen çöküş limitinin (%30 kayıp) aşılma ihtimali %5'ten büyükse strateji elenir.

---

## 📊 4. Market Regime Detection (Piyasa Rejimleri)
Stratejiler genelde tek bir piyasa yapısında (ör. sadece boğa piyasasında) para kazandırır. Platform, ATR ve EMA200 kullanarak piyasayı 4 rejime ayırır:
- **UP + LOW_VOL** (Yükseliş + Düşük Oynaklık)
- **UP + HIGH_VOL** (Yükseliş + Yüksek Oynaklık)
- **DOWN + LOW_VOL** (Düşüş + Düşük Oynaklık)
- **DOWN + HIGH_VOL** (Düşüş + Yüksek Oynaklık)

Her işlemin hangi piyasa rejiminde açıldığı ve kapatıldığı kaydedilir. Böylece stratejinin hangi rejimlerde başarılı olduğu (Regime Coverage) net olarak raporlanır.
