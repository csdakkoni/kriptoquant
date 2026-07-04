# KriptoQuant JSON Strategy DSL (Strategy Factory)

Strategy Factory, kod yazmaya gerek kalmadan, JSON formatında indikatörler, filtreler, giriş ve çıkış kuralları tanımlamanızı sağlayan bir AST (Abstract Syntax Tree) yapısıdır.

---

## 📄 Şema Yapısı (JSON Schema)

Örnek bir strateji dosyası (`examples/ema_cross.json`):

```json
{
  "metadata": {
    "name": "ema-cross",
    "version": "1.0.0",
    "description": "EMA Crossover Strategy with RSI Filter",
    "tags": ["trend", "ema"]
  },
  "warmupPeriod": 50,
  "indicators": [
    { "id": "fastEMA", "type": "ema", "params": [9] },
    { "id": "slowEMA", "type": "ema", "params": [21] },
    { "id": "rsi14", "type": "rsi", "params": [14] }
  ],
  "filters": [
    {
      "type": "comparison",
      "operator": "<",
      "left": { "type": "indicator", "id": "rsi14" },
      "right": { "type": "constant", "value": 70 }
    }
  ],
  "entry": {
    "type": "comparison",
    "operator": ">",
    "left": { "type": "indicator", "id": "fastEMA" },
    "right": { "type": "indicator", "id": "slowEMA" }
  },
  "exit": {
    "type": "comparison",
    "operator": "<",
    "left": { "type": "indicator", "id": "fastEMA" },
    "right": { "type": "indicator", "id": "slowEMA" }
  }
}
```

---

## ⚙️ Ana Bileşenler

### 1. `metadata`
Stratejinin adı, açıklaması, sürümü ve etiketleri.
```typescript
interface Metadata {
	readonly name: string;
	readonly version: string;
	readonly description?: string;
	readonly tags?: string[];
}
```

### 2. `warmupPeriod`
İndikatörlerin sağlıklı çalışabilmesi için geçmesi gereken minimum mum bar sayısı (ör. EMA 200 için en az 200).

### 3. `indicators` (İndikatör Tanımları)
Kullanılacak indikatörlerin parametreleri burada dizi (`params`) olarak listelenir.
Desteklenen indikatör tipleri ve parametre sıraları:
- **`ema`**: `[period]` (Varsayılan: `[20]`)
- **`sma`**: `[period]` (Varsayılan: `[20]`)
- **`rsi`**: `[period]` (Varsayılan: `[14]`)
- **`macd`**: `[fast, slow, signal]` (Varsayılan: `[12, 26, 9]`)
- **`donchian`**: `[period]` (Varsayılan: `[20]`) -> Ürettiği kanallar: `.upper`, `.lower`
- **`atr`**: `[period]` (Varsayılan: `[14]`)
- **`supertrend`**: `[period, multiplier]` (Varsayılan: `[10, 3]`) -> Ürettiği değerler: `.direction` (1 = Bull, -1 = Bear)

---

## ⚡ AST İfadeleri ve Kurallar

`filters`, `entry` ve `exit` alanlarında aşağıdaki kurallar hiyerarşik olarak birleştirilebilir:

### A) Karşılaştırma (`comparison`)
İki değeri (indikatör değeri, sabit sayı veya close fiyatı) karşılaştırır.
- **Operatörler**: `>`, `<`, `>=`, `<=`, `==`, `!=`, `cross-above`, `cross-below`
- **Sol ve Sağ Değer Tipleri**:
  - `indicator`: Belirtilen id'li indikatörün anlık bar değeri.
  - `constant`: Sabit bir sayı (ör. 70).
  - `close`: Mum barının kapanış fiyatı (id gerekmez).

*Örnek*: Kapanış fiyatı Donchian üst kanalını yukarı kırdığında:
```json
{
  "type": "comparison",
  "operator": "cross-above",
  "left": { "type": "close" },
  "right": { "type": "indicator", "id": "dc.upper" }
}
```

### B) Mantıksal Kapı (`logical`)
Birden çok kuralı mantıksal olarak birleştirir.
- **Operatörler**: `AND`, `OR`
- **Koşullar**: Karşılaştırma veya başka mantıksal kapılar dizisi (`conditions`).

*Örnek*: Fast EMA Slow EMA'dan büyük olacak **VE** RSI 70'ten küçük olacak:
```json
{
  "type": "logical",
  "operator": "AND",
  "conditions": [
    {
      "type": "comparison",
      "operator": ">",
      "left": { "type": "indicator", "id": "fastEMA" },
      "right": { "type": "indicator", "id": "slowEMA" }
    },
    {
      "type": "comparison",
      "operator": "<",
      "left": { "type": "indicator", "id": "rsi14" },
      "right": { "type": "constant", "value": 70 }
    }
  ]
}
```
Strategy Factory bu yapıyı hiyerarşik olarak okur, verileri hazırlar ve performanstan ödün vermeden optimize backtest sinyallerine dönüştürür.
