# KriptoQuant Gelişmiş Finansal Metrikler

Bu döküman platformda hesaplanan gelişmiş analiz metriklerinin formüllerini, finansal yorumlarını ve ideal eşik değerlerini açıklamaktadır.

---

## 1. Expectancy (Beklenen Getiri)

İşlem başına beklenen ortalama kar veya zararı ölçer. Stratejinin uzun vadeli hayatta kalma gücüdür.

- **Expectancy (USDT)**: `(WinRate * AvgWinUsdt) - (LossRate * AvgLossUsdt)`
- **Expectancy (%)**: `(WinRate * AvgWin%) - (LossRate * AvgLoss%)`
- **Expectancy (R)**: Ortalama R-multiple kazancı. `R = (ExitPrice - EntryPrice) / (EntryPrice - StopLossPrice)`.
- **Yorum**: Expectancy değerinin pozitif olması stratejinin bir "edge" (avantaj) ürettiğini gösterir. Negatif expectancy olan stratejiler kesinlikle canlıya alınmamalıdır.
- **İdeal Değer**: `Expectancy (R) > 0.20` veya `Expectancy (%) > 0.50%`

---

## 2. System Quality Number (SQN)

Van Tharp tarafından geliştirilen, sistemin kalitesini ve tutarlılığını ölçen bir puandır.

- **Formül**: `SQN = (Mean(R-multiples) / StdDev(R-multiples)) * sqrt(TradeCount)`
- **Güvenlik Sınırı**: İstatistiksel hata payını engellemek için `N < 30` ise hesaplanmaz.
- **Yorum**: 
  - `1.6 - 1.9`: Zayıf (canlıya alınmaz)
  - `2.0 - 2.4`: Ortalama (canlıya alınabilir)
  - `2.5 - 2.9`: İyi
  - `3.0+`     : Mükemmel
- **İdeal Değer**: `SQN >= 2.0`

---

## 3. Kelly Fraction (Kelly Kriteri)

Kasanın maksimum geometrik büyümesini hedefleyen optimal pozisyon büyüklüğü oranını belirler.

- **Formül**: `Kelly = WinRate - (LossRate / (AvgWin% / AvgLoss%))`
- **Güvenlik Sınırı**: İstatistiksel olarak dalgalanmaları önlemek için `N < 30` ise hesaplanmaz.
- **Yorum**: Çıkan Kelly oranı (örn: 0.15 = %15), optimal kasa büyüklüğünü temsil eder. Pratikte Kelly oranı çok agresiftir. Genellikle Kelly oranının yarısı veya çeyreği (**Fractional Kelly**) kullanılır.
- **İdeal Değer**: `0.05 ile 0.30` arası karlı sistemler için idealdir.

---

## 4. Ulcer Index (Acı Endeksi)

Portföyün drawdown'da (zirveden düşüş) ne kadar derin kaldığını ve orada ne kadar uzun süre (süreç bazlı) vakit geçirdiğini ölçer. Standart drawdown metriğinden daha gerçekçidir.

- **Formül**: `UI = sqrt( sum(Drawdown_t^2) / N )`
- **Yorum**: Yatırımcının psikolojik olarak stratejiye ne kadar dayanabileceğini ölçer. Düşük UI, portföyün zirveden düştükten sonra hızla toparlandığını gösterir.
- **İdeal Değer**: `UI < 5.0` (Çok güvenli), `UI > 15.0` (Stresli/tehlikeli).

---

## 5. MAR Ratio

Maksimum risk ile getiriyi oranlayan getiri/risk metriğidir.

- **Formül**: `MAR = TotalReturn / MaxDrawdown`
- **Yorum**: Getirinin risk bütçesini ne kadar verimli kullandığını gösterir. Yüksek MAR oranları tercih edilir.
- **İdeal Değer**: `MAR > 1.0` (Strateji drawdown oranından daha yüksek kar üretmeli), `MAR > 2.0` (Mükemmel).

---

## 6. Recovery Factor (Toparlanma Faktörü)

Stratejinin geçmişte düştüğü en derin çukurdan (drawdown) ne kadar hızlı veya güçlü çıkabildiğini ölçer.

- **Formül**: `RecoveryFactor = NetProfit / MaxDrawdownNominal`
- **Yorum**: Değerin 1.0'dan küçük olması stratejinin henüz drawdown'ı tam olarak tolere edemediğini gösterir. Yüksek olması toparlanma gücünü kanıtlar.
- **İdeal Değer**: `RecoveryFactor >= 3.0`

---

## 7. MAE / MFE (Maximum Adverse / Favorable Excursion)

Bir işlemin açık kaldığı süre boyunca yaşadığı maksimum stres (kayıp) ve maksimum ödül (kar) potansiyelini ölçer.

- **MAE (Maximum Adverse Excursion)**: İşlem içi görülen en düşük fiyatın giriş fiyatına oranı (%).
- **MFE (Maximum Favorable Excursion)**: İşlem içi görülen en yüksek fiyatın giriş fiyatına oranı (%).
- **Yorum**: Stop-loss ve take-profit hedeflerinin optimize edilmesinde en kritik analiz aracıdır. MAE değerleri sürekli stop seviyesinin çok yakınından dönüyorsa stop gevşetilebilir; MFE yüksek olup işlem zararla kapanıyorsa take-profit hedefleri konulabilir.
