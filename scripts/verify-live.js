async function check() {
  try {
    const [exps, assumptions, kg] = await Promise.all([
      fetch('http://34.107.2.151:3008/api/organism/experiments').then(r => r.json()),
      fetch('http://34.107.2.151:3008/api/organism/assumptions').then(r => r.json()),
      fetch('http://34.107.2.151:3008/api/organism/knowledge').then(r => r.json())
    ]);

    const synths = (exps || []).filter(e => e.name && e.name.includes('[SYNTH]'));
    const dead = (assumptions || []).find(a => a.status === 'killed');
    const insights = (kg.nodes || []).filter(n => n.type === 'insight');

    console.log("=== 1. EVRİM KANITI (Evolver Çalışıyor mu?) ===");
    console.log(`Üretilen yepyeni sentetik deney sayısı: ${synths.length}`);
    if(synths.length > 0) {
      console.log(`Örnek: ${synths[0].name}`);
      console.log(`Hipotez: ${synths[0].hypothesis}`);
    }

    console.log("\n=== 2. YANLIŞLAMA KANITI (Assumption Killer Çalışıyor mu?) ===");
    if(dead) {
      console.log(`Öldürülen varsayım: "${dead.statement}"`);
      console.log(`Bunu öldürmek için toplanan kanıt sayısı: ${dead.evidence?.length || 0}`);
      if (dead.evidence && dead.evidence.length > 0) {
        console.log(`Örnek bir kanıt (makine tarafından yazılmış):`);
        console.log(`"${dead.evidence[dead.evidence.length-1].reason}"`);
      }
    }

    console.log("\n=== 3. BİLGİ AĞI KANITI (Gözlemciler Çalışıyor mu?) ===");
    console.log(`Üretilen üst düzey içgörü (insight) sayısı: ${insights.length}`);
    if(insights.length > 0) {
      console.log(`Örnek İçgörü (Sistemin kendi kendine çıkardığı sonuç):`);
      console.log(`"${insights[0].description}"`);
    }

  } catch(e) {
    console.error("Hata:", e.message);
  }
}

check();
