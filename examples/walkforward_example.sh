#!/usr/bin/env bash

# ============================================================================
# KriptoQuant — Walk-Forward & Portfolio Research Examples
# ============================================================================
# Bu betik, platformdaki temel araştırma akışlarını sırayla çalıştırır.
# ============================================================================

set -e

echo "======================================================================"
echo "  🔬 KRIPTOQUANT RESEARCH EXPERIMENT RUNNER"
echo "======================================================================"

# 1) Tarihsel Veri Çekme (Fetch)
echo -e "\n1. Veri yükleme süreci başlatılıyor..."
npx tsx src/cli.ts fetch --coin BTCUSDT --interval 1d
npx tsx src/cli.ts fetch --coin ETHUSDT --interval 1d

# 2) Özel JSON Stratejisi ile Backtest
echo -e "\n2. JSON Strategy Factory backtest'i çalıştırılıyor..."
npx tsx src/cli.ts backtest-config --config examples/ema_cross.json --coin BTCUSDT --interval 1d

# 3) Rolling Walk-Forward Validation
echo -e "\n3. Kayan pencereli Walk-Forward doğrulaması yapılıyor..."
npx tsx src/cli.ts walkforward-rolling --strategy ema-cross --coin BTCUSDT --interval 1d

# 4) Çoklu Varlık Portföy Backtest
echo -e "\n4. Çoklu varlık portföy testi (Risk Bütçeli) çalıştırılıyor..."
npx tsx src/cli.ts portfolio-backtest --strategy ema-cross --coins BTCUSDT,ETHUSDT --interval 1d --allocation risk-budget --risk-percent 1.5 --max-positions 2

# 5) Uçtan Uca Entegrasyon Doğrulama
echo -e "\n5. Platform entegrasyonu verify-e2e ile test ediliyor..."
npx tsx src/cli.ts verify-e2e

echo -e "\n🎉 Tüm testler başarıyla tamamlandı!"
echo "======================================================================"
