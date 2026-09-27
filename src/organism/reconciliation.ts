import { log, logError } from '../core/utils.js';
import { config } from '../core/config.js';
import type { Experiment } from './experiment-runner.js';
import type { LiveBroker } from './live-broker.js';
import { roundTripCostPct } from './costs.js';
import { fundingTracker } from './funding.js';

/**
 * Sunucu başlangıcında veya periyodik olarak borsa (Binance) ile
 * organizmanın veritabanını (experiments.json) senkronize eder.
 *
 * 1. Sunucu kapalıyken Binance'te STOP_MARKET veya TAKE_PROFIT_MARKET tetiklenip
 *    kapanan pozisyonları tespit eder ve experiments.json'a işler.
 * 2. Risk yöneticisindeki açık işlem sayacını borsadaki gerçek pozisyon sayısına eşitler.
 * 3. Borsada açık olan fakat organizmada bulunmayan "öksüz" (orphan) pozisyonları tespit edip raporlar.
 */
// Aynı anda iki mutabakat koşmasın (15dk'lık tetik + başlangıç çağrısı çakışabilir)
let reconcileInFlight = false;

export async function reconcilePositions(experiments: Experiment[], liveBroker: LiveBroker): Promise<void> {
	if (!liveBroker.isLive()) {
		log('[RECONCILIATION] ℹ️ Live trading devrede değil (Dry-run). Borsa senkronizasyonu atlandı.');
		return;
	}
	if (reconcileInFlight) {
		log('[RECONCILIATION] ⏭️ Önceki mutabakat hâlâ sürüyor, bu tur atlandı.');
		return;
	}
	reconcileInFlight = true;

	try {
		log('[RECONCILIATION] 🔄 Borsa pozisyonları taranıyor ve senkronize ediliyor...');
		const exchangePositions = await liveBroker.fetchOpenPositions();
		if (exchangePositions === null) {
			// Borsa sorgusu başarısız: "pozisyon yok" ile karıştırılırsa tüm canlı
			// pozisyonlar kapanmış sayılır ve sonraki turda öksüz diye kapatılır.
			logError('[RECONCILIATION] ⚠️ Borsa pozisyonları alınamadı — mutabakat bu tur atlandı.');
			return;
		}

		const exchangePositionsByCoin = new Map<string, any>();
		for (const p of exchangePositions) {
			const coin = liveBroker.toCoin(p.symbol || p.id);
			if (Math.abs(Number(p.contracts || 0)) > 0) {
				exchangePositionsByCoin.set(coin, p);
			}
		}

		let totalSyncedClosed = 0;
		let totalActiveLivePositions = 0;

		for (const exp of experiments) {
			if (!exp.positions.some(p => p.isLive)) continue;

			const openPositions = [...exp.positions];
			for (const pos of openPositions) {
				if (!pos.isLive) continue;
				// livePending pozisyonları atla — entry henüz tamamlanmadı
				if ((pos as any).livePending) continue;

				const exPos = exchangePositionsByCoin.get(pos.coin);
				if (!exPos || Math.abs(Number(exPos.contracts || 0)) === 0) {
					// Pozisyon borsada KAPANMIŞ (Stop-loss veya Take-profit çalışmış)
					log(`[RECONCILIATION] ⚠️ ${exp.name} | ${pos.coin} pozisyonu borsada kapanmış. Gerçek kapanış fiyatı aranıyor...`);

					// BUG #2 FIX: Gerçek kapanış fiyatını borsanın işlem geçmişinden çek.
					// Eski kod pos.entryPrice'a düşüyordu → tüm reconcile işlemleri -%0.30 görünüyordu.
					let exitPrice = pos.entryPrice; // Son çare: giriş fiyatı (flat PnL)
					try {
						const trades = await liveBroker.fetchRecentTrades(pos.coin);
						if (trades.length > 0) {
							// En son kapanış işlemini bul (reduceOnly olan)
							const closingTrade = trades
								.filter((t: any) => t.info?.reduceOnly === true || t.info?.reduceOnly === 'true')
								.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];
							if (closingTrade) {
								exitPrice = Number(closingTrade.price);
								log(`[RECONCILIATION] 💰 ${pos.coin} gerçek kapanış fiyatı bulundu: $${exitPrice} (İşlem ID: ${closingTrade.id})`);
							} else {
								// reduceOnly filtresi bulamadıysa en son işlemi al
								const lastTrade = trades.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];
								if (lastTrade) {
									exitPrice = Number(lastTrade.price);
									log(`[RECONCILIATION] 💰 ${pos.coin} son işlem fiyatı kullanılıyor: $${exitPrice}`);
								}
							}
						}
					} catch (tradeErr: any) {
						logError(`[RECONCILIATION] ⚠️ ${pos.coin} işlem geçmişi çekilemedi (giriş fiyatı kullanılacak): ${tradeErr?.message || tradeErr}`);
					}

					const sign = pos.side === 'short' ? -1 : 1;
					const actualRoundTripFee =
						roundTripCostPct(pos) + fundingTracker.fundingCostPct(pos.coin, pos.side, pos.entryTime, Date.now());
					const pnlPct = sign * ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 - actualRoundTripFee;

					pos.exitPrice = exitPrice;
					pos.exitTime = Date.now();
					pos.exitReason = 'exchange_bracket_trigger';
					pos.pnlPercent = pnlPct;

					exp.closedPositions.push({ ...pos });
					exp.positions = exp.positions.filter(p => p.id !== pos.id);
					totalSyncedClosed++;

					// Risk yöneticisini güncelle
					const pnlUsd = (pnlPct / 100) * config.risk.maxTradeSizeUsd;
					liveBroker.getRiskManager().onTradeClosed(pnlUsd);
				} else {
					totalActiveLivePositions++;
				}
			}
		}

		// Öksüz işlem kontrolü — borsada açık ama organizmada kayıtsız pozisyonları OTOMATİK KAPAT
		const trackedCoins = new Set<string>();
		for (const exp of experiments) {
			for (const pos of exp.positions) {
				// livePending: giriş emri borsada dolmuş ama yanıt henüz işlenmemiş
				// olabilir — öksüz sanılıp kapatılmamalı.
				if (pos.isLive || pos.livePending) trackedCoins.add(pos.coin);
			}
		}

		for (const [coin, exPos] of exchangePositionsByCoin.entries()) {
			if (!trackedCoins.has(coin)) {
				const contracts = Math.abs(Number(exPos.contracts || 0));
				// CCXT'de contracts her zaman pozitiftir; yön exPos.side alanındadır
				const side = exPos.side === 'short' ? 'short' : 'long';
				logError(
					`[RECONCILIATION] 🚨 ÖKSÜZ POZİSYON TESPİT EDİLDİ: ${coin} (${contracts} kontrat, ${side}). Otomatik kapatılıyor...`,
				);
				try {
					// Önce bu sembolün bekleyen emirlerini iptal et
					await liveBroker.cancelAllOrders(coin);
					// Sonra pozisyonu reduceOnly market emriyle kapat
					await liveBroker.executeExit(coin, side as 'long' | 'short', 0, 0);
					log(`[RECONCILIATION] ✅ Öksüz ${coin} pozisyonu başarıyla kapatıldı.`);
				} catch (closeErr: any) {
					logError(`[RECONCILIATION] ❌ Öksüz ${coin} kapatılamadı: ${closeErr?.message || closeErr}. Manuel müdahale gerekli!`);
				}
			}
		}

		// RiskManager açık işlem sayısını borsa ile senkronize et
		liveBroker.getRiskManager().syncOpenTradesCount(totalActiveLivePositions);

		log(
			`[RECONCILIATION] ✅ Senkronizasyon tamamlandı: ${totalActiveLivePositions} aktif canlı pozisyon, ` +
			`${totalSyncedClosed} borsada kapanmış işlem eşitlendi.`,
		);
	} catch (error: any) {
		logError(`[RECONCILIATION] Mutabakat hatası: ${error?.message || error}`);
	} finally {
		reconcileInFlight = false;
	}
}
