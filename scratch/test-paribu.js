import { ParibuClient } from '../src/data/paribu-client.js';
import { ParibuBroker } from '../src/execution/paribu-broker.js';
import { log, logError } from '../src/core/utils.js';

async function testParibuIntegration() {
	log('================================================================');
	log('🧪 STARTING PARIBU CLIENT & BROKER VERIFICATION TEST');
	log('================================================================');

	const client = new ParibuClient();
	const broker = new ParibuBroker();

	// Test 1: Fetch raw ticker
	try {
		log('\n[Test 1] Fetching raw ticker data from Paribu...');
		const ticker = await client.fetchTicker();
		const pairs = Object.keys(ticker);
		log(`  ✓ Successfully fetched Paribu ticker. Found ${pairs.length} currency pairs.`);
		if (pairs.length === 0) throw new Error('Empty ticker returned!');
	} catch (e) {
		logError(`  ❌ Test 1 Failed: ${e.message}`);
		process.exit(1);
	}

	// Test 2: Get USD/TRY Rate
	try {
		log('\n[Test 2] Fetching current USD/TRY conversion rate...');
		const rate = await client.getUsdTryRate();
		log(`  ✓ Current rate: ${rate} TL`);
		if (rate < 10 || rate > 60) throw new Error(`Suspicious rate returned: ${rate}`);
	} catch (e) {
		logError(`  ❌ Test 2 Failed: ${e.message}`);
		process.exit(1);
	}

	// Test 3: Get coin price in USDT (with and without conversion)
	try {
		log('\n[Test 3] Fetching prices in USDT...');
		// BTCUSDT (has direct USDT pair)
		const btcPrice = await client.getCoinPriceInUsdt('BTCUSDT');
		log(`  ✓ BTC price: $${btcPrice.toLocaleString()} USDT`);
		if (btcPrice <= 0) throw new Error('Invalid BTC price!');

		// NEARUSDT (trades only in TL on Paribu - tests conversion layer!)
		const nearPrice = await client.getCoinPriceInUsdt('NEARUSDT');
		log(`  ✓ NEAR price (converted from TL): $${nearPrice.toFixed(4)} USDT`);
		if (nearPrice <= 0) throw new Error('Invalid NEAR price!');
	} catch (e) {
		logError(`  ❌ Test 3 Failed: ${e.message}`);
		process.exit(1);
	}

	// Test 4: Simulated broker buy execution
	try {
		log('\n[Test 4] Simulating paper trade buy order...');
		const fill = await broker.buy(Date.now(), 63000, 100);
		log('  ✓ Executed Fill Object:');
		console.log(fill);
		if (fill.side !== 'BUY') throw new Error('Invalid side');
		if (fill.quantity <= 0) throw new Error('Invalid quantity');
		if (fill.commission <= 0) throw new Error('Invalid commission');
	} catch (e) {
		logError(`  ❌ Test 4 Failed: ${e.message}`);
		process.exit(1);
	}

	// Test 5: Simulated broker sell execution
	try {
		log('\n[Test 5] Simulating paper trade sell order...');
		const fill = await broker.sell(Date.now(), 63000, 0.0015);
		log('  ✓ Executed Fill Object:');
		console.log(fill);
		if (fill.side !== 'SELL') throw new Error('Invalid side');
		if (fill.quantity !== 0.0015) throw new Error('Invalid quantity match');
		if (fill.commission <= 0) throw new Error('Invalid commission');
	} catch (e) {
		logError(`  ❌ Test 5 Failed: ${e.message}`);
		process.exit(1);
	}

	log('\n================================================================');
	log('🎉 ALL PARIBU VERIFICATION TESTS COMPLETED SUCCESSFULLY!');
	log('================================================================');
}

testParibuIntegration();
