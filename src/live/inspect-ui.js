// ============================================================================
// KRIPTOQUANT — CDP Headless Browser Console Inspector (Sprint 27)
// ============================================================================

import { WebSocket } from 'ws';

async function main() {
	console.log("Querying Chrome Debugger targets at http://localhost:9222/json/list...");
	
	let targets;
	try {
		const res = await fetch('http://localhost:9222/json/list');
		targets = await res.json();
	} catch (e) {
		console.error("Failed to query Chrome DevTools port. Make sure headless Chrome is running at port 9222.");
		process.exit(1);
	}

	console.log(`Found ${targets.length} targets.`);
	
	// Pick the first page target
	const target = targets.find((t) => t.type === 'page');
	if (!target) {
		console.error("No active page target found in Chrome DevTools.");
		process.exit(1);
	}
	
	console.log(`Connecting to CDP target: ${target.webSocketDebuggerUrl}`);
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	
	ws.on('open', () => {
		console.log('CDP Debugger connected. Capturing logs and navigating to: http://localhost:3008');
		ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
		ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
		ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: 'http://localhost:3008' } }));
	});
	
	let hasErrors = false;
	
	ws.on('message', (dataStr) => {
		try {
			const data = JSON.parse(dataStr);
			if (data.method === 'Runtime.exceptionThrown') {
				console.error('❌ UNCAUGHT EXCEPTION THROWN:', JSON.stringify(data.params.exceptionDetails, null, 2));
				hasErrors = true;
			}
			if (data.method === 'Console.messageAdded') {
				const text = data.params.message.text;
				const level = data.params.message.level;
				if (level === 'error') {
					console.error(`❌ CONSOLE ERROR: ${text}`);
					hasErrors = true;
				} else {
					console.log(`💬 CONSOLE LOG: ${text}`);
				}
			}
		} catch (e) {
			// ignore parse errors of other devtools protocols
		}
	});
	
	setTimeout(() => {
		console.log(`\n================================================================`);
		if (hasErrors) {
			console.error("❌ UI INSPECTION FAILED WITH ERRORS/EXCEPTIONS.");
			process.exit(1);
		} else {
			console.log("✅ UI INSPECTION PASSED: NO CONSOLE ERRORS OR EXCEPTIONS DETECTED.");
			process.exit(0);
		}
	}, 6000);
}

main().catch(err => {
	console.error("CDP inspection handler failed:", err);
	process.exit(1);
});
