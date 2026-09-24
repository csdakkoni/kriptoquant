const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'organism-data', 'experiments.json');
if (!fs.existsSync(file)) {
	console.log('experiments.json bulunamadi.');
	process.exit(1);
}

let experiments = JSON.parse(fs.readFileSync(file, 'utf-8'));
const initialCount = experiments.length;

// Sadece bu isimlere sahip olan deneyleri sakla (Gelecekte doğacak olanlar ve geçmiş verileri)
const allowedNames = [
	'Altın Saat Swing (Rejim Yönlü, 3%/6%)',
	'Swing Dip %5 → Hedef +%6 (Erdem ölçeği v1)',
	'Swing Dip %5 → Hedef +%6 (Erdem ölçeği)',
	'Swing Dip ATR → Hedef 3×ATR (Erdem ölçeği v2)',
	'Gözlem Tetikli Giriş (Herd 24h Takibi)',
	'Gözlem Tetikli Giriş (Silence Sıkışma Patlaması)',
	'Gözlem Tetikli Giriş (Divergence RSI Uyumsuzluğu)'
];

// Ayiklama mantigi: Ismi allowedNames icinde olanlari tut, veya KANIT/CROSS olup hala is yapanlari tut
experiments = experiments.filter(e => {
	// Eger cekirdek kadrodaysa TAVİZ YOK tut.
	if (allowedNames.includes(e.name)) return true;
	
	// Eger herd sinyali cross'u ise veya herd ise tut
	if (e.name.includes('herd')) return true;

	// Diger butun eski 'Hit & Run', 'SMA20', 'Her 4 Saatte', 'Random SHORT' vesaire SİLİNİR.
	return false;
});

fs.writeFileSync(file, JSON.stringify(experiments, null, 2));

console.log(`Temizlik tamamlandi! ${initialCount} deneyden ${experiments.length} deney kaldi. (${initialCount - experiments.length} gereksiz deney silindi).`);
console.log('Lutfen organizmayi yeniden baslatin: pm2 restart organism');
