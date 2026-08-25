// ============================================================================
// ORGANISM — Evolver (Kanıt → Deney köprüsü)
// ============================================================================
// Görevi üç şey:
//   1. Gözlem karnesinde KANITLANMIŞ üstünlük gösteren sinyallerden deney doğur
//   2. Maliyeti aşan deneyleri "aday" ilan et, sistematik kaybedeni öldür
//   3. En iyi girişle en iyi çıkışı çaprazla
//
// 4 Ağu değişikliği — deney doğurma kaynağı değişti:
// Eskiden 6 adet ELLE YAZILMIŞ kural vardı ve varsayım verdiktlerine bakıyordu
// ("coinler bağımsızdır ölürse şu deneyi kur"). İki sorun vardı:
//   • Bağlantılar kopuktu: "Hacim Patlaması Girişi" adındaki deneyin giriş
//     sinyali hacim değil 'divergence'tı; "BTC Liderlik Takibi" ise canlıda
//     hiç üretilmeyen 'herd' gözlemine bağlıydı — doğsa bile işlem açamazdı.
//   • Kaynağı kanıt değil, bizim tahminimizdi.
// Artık deneyler yalnızca gözlem karnesinin ölçtüğü kanıttan doğar: bir gözlem
// tipi yeterli örneklemle maliyeti aşan bir getiri gösteriyorsa, o tipe ve o
// vadeye göre deney kurulur. Böylece karne süs olmaktan çıkıp karar verir.
// ============================================================================

import { log } from '../core/utils.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ObservationScoreboard } from './observation-scoreboard.js';
import { ExperimentRunner, isControlExperiment, type Experiment, type EntryRule, type ExitRule } from './experiment-runner.js';
import { randomUUID } from 'node:crypto';

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

// ─── Experiment Performance Thresholds ───────────────────────────────────────

// ─── Terfi / Öldürme eşikleri ────────────────────────────────────────────────
// 3 Ağu denetimi: eski eşikler TOPLAM yüzdeye bakıyordu (minPnl 1.0, maxLoss -5,
// maxDrawdown 8). Toplam, işlem sayısıyla büyür — ortalama %1.5 zarar eden bir
// deneyde 6 ardışık kayıp 9 puan "drawdown" yapar ve deney kalitesinden bağımsız
// olarak ÖLÜR. 1 Ağu'daki toplu yok oluşun sebebi buydu.
//
// Yeni eşikler İŞLEM BAŞINA ortalamaya bakar — ölçekten bağımsızdır ve doğrudan
// anlamlıdır: pnlPercent zaten %0.3 maliyet düşülmüş nettir, yani ortalama > 0
// olması "maliyeti aşıyor" demektir.
const MIN_TRADES_FOR_VERDICT = 20;
const PROMOTE_AVG_PNL = 0.15;  // işlem başına net +%0.15 → maliyeti anlamlı şekilde aşıyor
const KILL_AVG_PNL = -0.5;     // işlem başına net -%0.5 → sistematik kaybettiriyor

// ─── Evolver ─────────────────────────────────────────────────────────────────

export class Evolver {
	private synthesizedRules = new Set<string>(); // Track which rules already fired
	private promotedExperiments = new Set<string>();
	private killedExperiments = new Set<string>();

	constructor(
		private graph: KnowledgeGraph,
		private experimentRunner: ExperimentRunner,
	) {
		// Kalıcı alanlardan hafızayı geri yükle — restart sonrası aynı deneyi
		// yeniden terfi ettirme/öldürme/sentezleme döngüsünü engeller.
		for (const exp of experimentRunner.getExperiments()) {
			if (exp.promoted) this.promotedExperiments.add(exp.id);
			if (exp.status === 'failed') this.killedExperiments.add(exp.id);
			if (exp.name.startsWith('[SYNTH]') || exp.name.startsWith('[CROSS]')) {
				// İsim bazlı dedupe zaten addExperiment'te; burada kural anahtarını
				// yeniden türetmek yerine sentezin varlığını isimle işaretliyoruz.
				this.synthesizedRules.add(`name:${exp.name}`);
			}
		}
	}

	/** Organizma döngüsü tarafından periyodik çağrılır. */
	evolve(scoreboard: ObservationScoreboard): void {
		this.synthesizeFromEvidence(scoreboard);
		this.evaluateExperiments();
		this.crossPollinate();
	}

	// ─── Aşama 1: Kanıt → Deney ───────────────────────────────────────
	//
	// Karnenin ölçtüğü her kanıtlanmış üstünlük için bir deney kurulur.
	// Deneyin PARÇALARI doğrudan kanıttan gelir — tahmin yok:
	//   • giriş sinyali = kanıtı veren gözlem tipinin ta kendisi
	//   • tutma süresi  = kanıtın ölçüldüğü vade (48 mumluk kanıt → 48 mum tut)
	//   • yön           = kanıtın işareti (düşüren sinyal short olarak denenir)
	// Böylece "hacim deneyi divergence'a bağlı" türü uyumsuzluk imkânsız hale
	// gelir: isim de kural da aynı ölçümden türetilir.

	private synthesizeFromEvidence(scoreboard: ObservationScoreboard): void {
		for (const edge of scoreboard.getProvenEdges()) {
			const key = `${edge.type}|${edge.horizon}|${edge.side}`;
			if (this.synthesizedRules.has(key)) continue;

			const saat = (edge.horizon * 15) / 60;
			const name = `[KANIT] ${edge.type} → ${edge.side === 'long' ? 'LONG' : 'SHORT'} ${saat}sa`;
			if (this.synthesizedRules.has(`name:${name}`)) continue;
			this.synthesizedRules.add(key);
			this.synthesizedRules.add(`name:${name}`);

			const experiment: Experiment = {
				id: randomUUID(),
				name,
				hypothesis:
					`Karne: "${edge.type}" gözleminden ${saat} saat sonra ortalama ` +
					`${edge.avgRet >= 0 ? '+' : ''}${edge.avgRet.toFixed(2)}%, ` +
					`isabet %${(edge.hitRate * 100).toFixed(0)}, örneklem ${edge.n}. ` +
					`Maliyeti aşıyorsa canlı deneyde de aşmalı.`,
				sourceAssumption: `karne:${edge.type}@${edge.horizon}`,
				entryRule: { type: 'on_observation', observationType: edge.type } as EntryRule,
				exitRule: { type: 'fixed_candles', n: edge.horizon } as ExitRule,
				side: edge.side,
				coins: COINS,
				status: 'running',
				startedAt: Date.now(),
				maxDurationHours: 720,
				positions: [],
				closedPositions: [],
				stats: {
					totalTrades: 0, wins: 0, losses: 0,
					totalPnlPercent: 0, avgPnlPercent: 0, winRate: 0,
					avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0,
				},
			};

			this.experimentRunner.addExperiment(experiment);
			log(`🧬 KANITTAN DOĞDU: "${name}" (n=${edge.n}, ort. ${edge.avgRet.toFixed(2)}%)`);
			this.graph.addInsight(
				`Gözlem karnesi "${edge.type}" tipinde ${saat} saatlik kanıt buldu ` +
				`(ort. ${edge.avgRet.toFixed(2)}%, n=${edge.n}) → deney kuruldu: ${name}`,
				[],
			);
		}
	}

	// ─── Phase 2b: Evaluate Experiments ───────────────────────────────

	private evaluateExperiments(): void {
		const experiments = this.experimentRunner.getExperiments();

		for (const exp of experiments) {
			if (exp.status !== 'running') continue;
			if (this.promotedExperiments.has(exp.id) || this.killedExperiments.has(exp.id)) continue;

			// KONTROLLER ÖLÇÜM CİHAZIDIR — terfi de etmez, öldürülmez de.
			// Zarar eden bir kontrolü "kötü performans" diye öldürmek,
			// soğuk gösterdi diye termometreyi çöpe atmaktır: kıyas tabanı yok
			// olur ve "bu deney rastgeleyi yeniyor mu?" sorusu cevapsız kalır.
			// (1 Ağu raporu: Evolver kontrolleri de öldürmüştü.)
			if (isControlExperiment(exp.name)) continue;

			const { stats } = exp;
			if (stats.totalTrades < MIN_TRADES_FOR_VERDICT) continue;

			// Terfi ve öldürme BİRBİRİNİ DIŞLAR — eski kodda iki blok da ayrı ayrı
			// çalışıyordu, bir deney aynı geçişte hem "⭐ ADAY" hem "💀 ÖLDÜ"
			// olabiliyordu.
			if (stats.avgPnlPercent >= PROMOTE_AVG_PNL) {
				this.promotedExperiments.add(exp.id);
				(exp as any).promoted = true; // kalıcılaştır
				this.experimentRunner.persist();

				log('');
				log('════════════════════════════════════════════════════════════');
				log(`⭐ PROMOTED: "${exp.name}"`);
				log(`   ${stats.totalTrades} trades | Win: ${stats.winRate.toFixed(1)}% | işlem başına: ${stats.avgPnlPercent >= 0 ? '+' : ''}${stats.avgPnlPercent.toFixed(3)}%`);
				log(`   → Bu deney gerçek para ile test edilmeye ADAY`);
				log('════════════════════════════════════════════════════════════');
				log('');

				this.graph.addInsight(
					`⭐ Experiment PROMOTED: "${exp.name}" — ${stats.totalTrades} trades, ${stats.winRate.toFixed(1)}% win rate, işlem başına ${stats.avgPnlPercent.toFixed(3)}%. CANDIDATE for real money.`,
					[],
				);
			} else if (stats.avgPnlPercent <= KILL_AVG_PNL) {
				this.killedExperiments.add(exp.id);
				// Öldürülen deney gerçekten DURMALI — eski kod sadece not alıyordu,
				// deney koşmaya devam ediyordu.
				(exp as any).status = 'failed';
				(exp as any).endedAt = Date.now();
				this.experimentRunner.persist();

				log('');
				log(`💀 EXPERIMENT KILLED: "${exp.name}" — işlem başına ${stats.avgPnlPercent.toFixed(3)}% (${stats.totalTrades} işlem)`);
				log('');

				this.graph.addInsight(
					`Experiment killed: "${exp.name}" — ${stats.totalTrades} trades, ${stats.totalPnlPercent.toFixed(2)}% PnL, ${stats.maxDrawdownPercent.toFixed(2)}% max drawdown. Hypothesis "${exp.hypothesis}" not supported by results.`,
					[],
				);
			}
		}
	}

	// ─── Phase 2c: Cross-Pollinate (winning traits breed) ─────────────

	private crossPollinate(): void {
		const experiments = this.experimentRunner.getExperiments();
		const promoted = experiments.filter(e => this.promotedExperiments.has(e.id));

		if (promoted.length < 2) return;

		// Check if we already cross-pollinated
		const crossKey = promoted.map(e => e.id).sort().join('|');
		if (this.synthesizedRules.has(`cross:${crossKey}`)) return;
		this.synthesizedRules.add(`cross:${crossKey}`);

		// Take the best entry from one and best exit from another
		const sorted = [...promoted].sort((a, b) => b.stats.totalPnlPercent - a.stats.totalPnlPercent);
		const bestEntry = sorted[0];
		const bestExit = sorted.length > 1 ? sorted[1] : sorted[0];

		const child: Experiment = {
			id: randomUUID(),
			name: `[CROSS] ${bestEntry.name.slice(0, 20)} × ${bestExit.name.slice(0, 20)}`,
			hypothesis: `En iyi giriş (${bestEntry.name}) + en iyi çıkış (${bestExit.name}) birleşimi`,
			sourceAssumption: 'cross-pollination',
			entryRule: bestEntry.entryRule,
			exitRule: bestExit.exitRule,
			// KRİTİK: Yön giriş deneyinden MİRAS ALINIR. Bu alan atlandığında
			// (24 Tem raporu) "en iyi SHORT girişi" long'a düşüp anlamsız bir
			// melez üretti: 6 işlem, %0 kazanma, -8.47%. Giriş kuralı yönünden
			// bağımsız değildir — SMA aşağı kırılımı long'da tam tersini yapar.
			side: bestEntry.side ?? 'long',
			coins: COINS,
			status: 'running',
			startedAt: Date.now(),
			maxDurationHours: 168,
			positions: [],
			closedPositions: [],
			stats: {
				totalTrades: 0, wins: 0, losses: 0,
				totalPnlPercent: 0, avgPnlPercent: 0, winRate: 0,
				avgWinPercent: 0, avgLossPercent: 0, maxDrawdownPercent: 0,
			},
		};

		this.experimentRunner.addExperiment(child);

		log('');
		log('════════════════════════════════════════════════════════════');
		log(`🧬 CROSS-POLLINATION: "${child.name}"`);
		log(`   Best entry × best exit = new offspring`);
		log('════════════════════════════════════════════════════════════');
		log('');

		this.graph.addInsight(
			`Cross-pollinated experiment: "${child.name}". Combined best entry from "${bestEntry.name}" with best exit from "${bestExit.name}".`,
			[],
		);
	}

	/** Get evolution stats for dashboard */
	getStats() {
		return {
			synthesizedCount: this.synthesizedRules.size,
			promotedCount: this.promotedExperiments.size,
			killedCount: this.killedExperiments.size,
			promotedIds: [...this.promotedExperiments],
		};
	}
}
