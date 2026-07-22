import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(process.cwd(), 'organism-data');

try {
  // 1. Evrimleşmiş (Evolver tarafından üretilmiş) deney var mı?
  const exps = JSON.parse(fs.readFileSync(path.join(dir, 'experiments.json'), 'utf-8'));
  const synths = exps.filter(e => e.name.includes('[SYNTH]'));

  // 2. Varsayımlar gerçekten kanıt biriktirip ölüyor mu?
  const assumptions = JSON.parse(fs.readFileSync(path.join(dir, 'assumptions-state.json'), 'utf-8'));
  const dead = assumptions.find(a => a.status === 'killed');

  // 3. Bilgi Ağı (Knowledge Graph) gerçekten düğüm (node) oluşturuyor mu?
  const kg = JSON.parse(fs.readFileSync(path.join(dir, 'knowledge-graph.json'), 'utf-8'));
  const insights = kg.nodes.filter(n => n.type === 'insight');

  console.log("=== 1. EVRİM KANITI (Evolver Çalışıyor mu?) ===");
  console.log(`Üretilen yepyeni sentetik deney sayısı: ${synths.length}`);
  if(synths.length > 0) {
    console.log(`Örnek: ${synths[0].name}`);
    console.log(`Hipotez: ${synths[0].hypothesis}`);
  }

  console.log("\n=== 2. YANLIŞLAMA KANITI (Assumption Killer Çalışıyor mu?) ===");
  if(dead) {
    console.log(`Öldürülen varsayım: "${dead.statement}"`);
    console.log(`Bunu öldürmek için toplanan kanıt sayısı: ${dead.evidence.length}`);
    console.log(`Örnek bir kanıt (makine tarafından yazılmış):`);
    console.log(`"${dead.evidence[dead.evidence.length-1].reason}"`);
  }

  console.log("\n=== 3. BİLGİ AĞI KANITI (Gözlemciler Çalışıyor mu?) ===");
  console.log(`Üretilen üst düzey içgörü (insight) sayısı: ${insights.length}`);
  if(insights.length > 0) {
    console.log(`Örnek İçgörü (Sistemin kendi kendine çıkardığı sonuç):`);
    console.log(`"${insights[0].description}"`);
  }

} catch(e) {
  console.error("Veri okunamadı:", e.message);
}
