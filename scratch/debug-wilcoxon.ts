import { runValidationLab } from '../src/research/validation-lab.js';

async function testGlobal() {
	const report = await runValidationLab({
		coins: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
		intervals: ['4h', '1d']
	});
	report.summaryTable.forEach(row => {
		console.log(`Global config: ${row.configName} -> pValueWilcoxon=${row.pValueWilcoxon}`);
	});
}

testGlobal();
