# KriptoQuant Portfolio Execution Engine

KriptoQuant Portföy Motoru, tek varlık kısıtını ortadan kaldırarak; çoklu kripto para birimini ortak bir bakiye, kaldıraç ve risk bütçesiyle eşzamanlı olarak simüle eder.

---

## 🏗️ Mimari Yapı

Portföy motorunun merkezinde 4 ana bileşen bulunur:

```
               [ TimelineProvider ]
    (Farklı varlıkların mum serilerini hizalar)
                        │
                        ▼
               [ PortfolioEngine ]
    (Süreç yürütme, t+1 emirler, sermaye eğrisi)
             ┌──────────┴──────────┐
             ▼                     ▼
     [ PositionBook ]     [ AllocationStrategy ]
   (Aktif pozisyonlar,    (Bakiye dilimleme ve
   stop takipleri, PnL)   dinamik ATR risk bütçeleme)
```

---

## 🕰️ 1. Timeline Provider (Mum Hizalama)
Çoklu varlık testi yapılırken her coinin veri boyutu ve tarihleri farklı olabilir. `CSVTimelineProvider`, tüm varlıkların mum verilerini kronolojik zaman damgalarına göre sıralar.
Her adımda (`openTime` bazında):
- Hangi coinlerin aktif mumları varsa onlar hizalanır.
- Stratejilerin sinyalleri sadece o andaki aktif mum değerleri üzerinden üretilir.

---

## 💼 2. Position Book (Hesap Defteri)
Tüm açık pozisyonları izleyen canonical tek merkezdir.
- **Stop-Loss Değerlemesi**: Her timeline adımında **önce stop-loss'lar kontrol edilir**. Stop olan pozisyonlar kapatılır. Pozisyondan boşalan slot ve bakiye, *aynı mum barı içinde* yeni gelen BUY sinyali tarafından kullanılabilir (Slot Devri / Slot Reuse).
- **Mark-to-Market Değerleme**: Portföyün toplam değeri, her adımda `Nakit + Açık Pozisyonların Güncel Kapanış Değerleri` formülüyle toplanır ve birleşik portföy sermaye eğrisi üretilir.

---

## 📊 3. Allocation Strategy (Sermaye Dağıtımı)

Strateji Desenine (Strategy Pattern) uygun olarak iki farklı bütçe dağıtıcı tanımlanmıştır:

### A) Equal Weight Allocation (`EqualWeightAllocation`)
Toplam sermaye, izin verilen maksimum pozisyon sayısına eşit dilimlere bölünür.
- **Formül**:
  $$\text{AllocationSize} = \frac{\text{CurrentEquity}}{\text{MaxPositions}}$$
- **Kullanım**: `--allocation equal`

### B) Risk Budget Allocation (`RiskBudgetAllocation`)
Pozisyon büyüklüğü, işlemin durdurma (stop-loss) mesafesine ve toplam portföyün hedeflenen risk limitine göre dinamik ayarlanır.
- **Formül**:
  $$\text{RiskAmount} = \text{CurrentEquity} \times \text{RiskPercent}$$
  $$\text{StopLossDistance} = \text{EntryPrice} - \text{StopLossPrice} \quad (\text{ATR tabanlı})$$
  $$\text{Quantity} = \frac{\text{RiskAmount}}{\text{StopLossDistance}}$$
  $$\text{AllocationSize} = \text{Quantity} \times \text{EntryPrice}$$
- Eğer `AllocationSize`, pozisyon başına düşen maksimum dilim limitini (`CurrentEquity / MaxPositions`) aşarsa, bütçe bu limite çekilir (Kasa Koruma Limitasyonu).
- **Kullanım**: `--allocation risk-budget --risk-percent 1.0` (işlem başına %1 portföy riski).
