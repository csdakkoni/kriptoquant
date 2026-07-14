# KriptoQuant — Autonomous Falsification Engine (v3.0)

> "KriptoQuant bir trading botu değildir. Finansal piyasalar için otonom bir
> yanlışlama (falsification) motorudur. Bilgi asıl üründür; trade sadece deneydir."

Sistem, piyasa hakkındaki varsayımları canlı veriyle test eder ve **öldürmeye çalışır**.
Ölen her varsayım bilgi üretir; hayatta kalan varsayımlar otomatik olarak paper-trading
deneylerine dönüşür. Deneyler kazanırsa aday statüsüne terfi eder, kaybederse ölür ve
ölümlerinden yeni hipotezler doğar.

## Mimari

```
Binance WS (10 coin, 15m)
        │
        ▼
   [ Observers ]          divergence / silence / herd / surprise tespiti
        │
        ▼
[ Assumption Killer ]     10+ varsayımı paralel test eder, %70 aleyhte kanıtla öldürür
        │
        ▼
[ Experiment Runner ]     bilgiyi paper-trade deneyleriyle sınar (long + SHORT)
        │
        ▼
     [ Evolver ]          kazananı terfi ettirir, kaybedeni öldürür, yenisini sentezler
        │
        ▼
[ Knowledge Graph + Journal ]   kalıcı bilgi + günlük araştırma jurnali
```

## Çalıştırma

```bash
npm run organism            # Yanlışlama motorunu başlat
npm run dashboard           # Web arayüzü (http://localhost:3008)
```

## Dürüst Ölçüm İlkeleri (pazarlık edilemez)

Bu ilkeler `legacy-two-wing` branch'indeki 100+ konfigürasyonluk deney arşivinin
kanıtladığı derslerden gelir:

1. **Her deney işleminde %0.3 gidiş-dönüş maliyeti düşülür.** Maliyetsiz simülasyon,
   ücret illüzyonu üretir — maliyetsiz "kârlı" görünen her hızlı strateji gerçekte eksiydi.
2. **Kanıt örneklemesi ~4 saatte bir yapılır.** Aynı veri penceresini her mumda yeniden
   ölçmek sahte örneklem büyüklüğü yaratır (pseudo-replication).
3. **Deney seti iki kanatlıdır (long + short).** Ayı piyasasında long-only deney seti
   kör kalır; 365 günlük ayı verisinde pozitif çıkan tek aile short trend takibiydi.
4. **Random kontrol deneyleri her zaman koşar.** Bir deney random'ı yenemiyorsa bilgi değildir.

## Tarihçe

- `legacy-two-wing` branch: Önceki mimari — backtest motoru, 8 stratejili canlı paper
  kadrosu, iki kanatlı (long/short) execution engine ve tüm araştırma laboratuvarları
  (scalp/swing/carry/capitulation labs). Organizmanın bulduğu bir edge'i gerçek
  emirlere taşımak gerektiğinde buradaki motor temel alınabilir.
