import { BinanceTrBroker } from '../src/execution/binance-tr-broker.js';
import { log, logError } from '../src/core/utils.js';

async function testBinanceTrIntegration() {
	log('================================================================');
	log('🧪 STARTING BINANCE TR BROKER VERIFICATION TEST');
	log('================================================================');

	const broker = new BinanceTrBroker();

	// Test 1: Simulated broker buy execution
	try {
		log('\n[Test 1] Simulating Binance TR paper trade buy order...');
		const fill = await broker.buy(Date.now(), 63000, 100);
		log('  ✓ Executed Fill Object:');
		console.log(fill);
		if (fill.side !== 'BUY') throw new Error('Invalid side');
		if (fill.quantity <= 0) throw new Error('Invalid quantity');
		if (fill.commission !== 0.10) throw new Error(`Invalid commission fee calculation: ${fill.commission}`);
	} catch (e) {
		logError(`  ❌ Test 1 Failed: ${e.message}`);
		process.exit(1);
	}

	// Test 2: Simulated broker sell execution
	try {
		log('\n[Test 2] Simulating Binance TR paper trade sell order...');
		const fill = await broker.sell(Date.now(), 63000, 0.0015);
		log('  ✓ Executed Fill Object:');
		console.log(fill);
		if (fill.side !== 'SELL') throw new Error('Invalid side');
		if (fill.quantity !== 0.0015) throw new Error('Invalid quantity match');
		if (Math.abs(fill.commission - 0.0944) > 0.001) throw new Error(`Invalid commission calculation: ${fill.commission}`);
	} catch (e) {
		logError(`  ❌ Test 2 Failed: ${e.message}`);
		process.exit(1);
	}

	log('\n================================================================');
	log('🎉 ALL BINANCE TR VERIFICATION TESTS COMPLETED SUCCESSFULLY!');
	log('================================================================');
}

testBinanceTrIntegration();
