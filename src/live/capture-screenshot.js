// ============================================================================
// KRIPTOQUANT — CDP Headless Screenshot Capture Script (Sprint 37)
// ============================================================================

import { WebSocket } from 'ws';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
	
	const target = targets.find((t) => t.type === 'page');
	if (!target) {
		console.error("No active page target found in Chrome DevTools.");
		process.exit(1);
	}
	
	console.log(`Connecting to CDP target: ${target.webSocketDebuggerUrl}`);
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	
	ws.on('open', () => {
		console.log('CDP Debugger connected. Enabling Page and Runtime...');
		ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
		ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
		
		console.log('Navigating to http://localhost:3008...');
		ws.send(JSON.stringify({ id: 3, method: 'Page.navigate', params: { url: 'http://localhost:3008' } }));
		
		// 1) Wait for page load, then load first report
		setTimeout(() => {
			console.log("Clicking the first report in the list to populate Decision Terminal...");
			ws.send(JSON.stringify({
				id: 10,
				method: 'Runtime.evaluate',
				params: { expression: "const card = document.querySelector('#reports-list > div'); if(card) { card.click(); 'clicked'; } else { 'not found'; }" }
			}));
			
			// 2) Wait for report values to propagate, then take first screenshot (Overview)
			setTimeout(() => {
				console.log("Capturing Decision Terminal (Overview) screenshot...");
				ws.send(JSON.stringify({
					id: 101,
					method: 'Page.captureScreenshot',
					params: { format: 'png' }
				}));
				
				// 3) Switch to 'live' tab
				setTimeout(() => {
					console.log("Switching tab to 'live'...");
					ws.send(JSON.stringify({
						id: 12,
						method: 'Runtime.evaluate',
						params: { expression: "switchTab('live')" }
					}));
					
					// 4) Wait and capture Live Paper dashboard screenshot
					setTimeout(() => {
						console.log("Capturing Live Paper dashboard screenshot...");
						ws.send(JSON.stringify({
							id: 102,
							method: 'Page.captureScreenshot',
							params: { format: 'png' }
						}));

						// 5) Switch to 'builder' tab
						setTimeout(() => {
							console.log("Switching tab to 'builder'...");
							ws.send(JSON.stringify({
								id: 14,
								method: 'Runtime.evaluate',
								params: { expression: "switchTab('builder')" }
							}));

							// 6) Wait and capture DSL builder screenshot
							setTimeout(() => {
								console.log("Capturing DSL Builder screenshot...");
								ws.send(JSON.stringify({
									id: 103,
									method: 'Page.captureScreenshot',
									params: { format: 'png' }
								}));
							}, 3000);

						}, 4000);

					}, 3000);
					
				}, 4000);
				
			}, 4000);
			
		}, 4000);
	});
	
	ws.on('message', (dataStr) => {
		try {
			const data = JSON.parse(dataStr);
			if (data.id) {
				console.log(`CDP RECEIVED - id: ${data.id}, hasError: ${!!data.error}`);
			}
			if (data.error) {
				console.error("CDP ERROR Details:", JSON.stringify(data.error));
			}

			// Save Overview Screenshot
			if (data.id === 101 && data.result && data.result.data) {
				const buffer = Buffer.from(data.result.data, 'base64');
				const targetPath = '/Users/erdemaslan/.gemini/antigravity/brain/166d07b1-e336-4cca-b36f-c03e10880ca4/visual_proof.png';
				writeFileSync(targetPath, buffer);
				console.log(`✅ OVERVIEW SCREENSHOT SAVED TO: ${targetPath}`);
			}
			
			// Save Live Screenshot
			if (data.id === 102 && data.result && data.result.data) {
				const buffer = Buffer.from(data.result.data, 'base64');
				const targetPath = '/Users/erdemaslan/.gemini/antigravity/brain/166d07b1-e336-4cca-b36f-c03e10880ca4/visual_proof_live.png';
				writeFileSync(targetPath, buffer);
				console.log(`✅ LIVE TAB SCREENSHOT SAVED TO: ${targetPath}`);
			}

			// Save Builder Screenshot
			if (data.id === 103 && data.result && data.result.data) {
				const buffer = Buffer.from(data.result.data, 'base64');
				const targetPath = '/Users/erdemaslan/.gemini/antigravity/brain/166d07b1-e336-4cca-b36f-c03e10880ca4/visual_proof_builder.png';
				writeFileSync(targetPath, buffer);
				console.log(`✅ BUILDER TAB SCREENSHOT SAVED TO: ${targetPath}`);
				process.exit(0);
			}
			
			if (data.method === 'Page.javascriptDialogOpening') {
				ws.send(JSON.stringify({
					id: 99,
					method: 'Page.handleJavaScriptDialog',
					params: { accept: true }
				}));
			}
		} catch (e) {
			console.error("Error handling CDP message:", e);
		}
	});
	
	setTimeout(() => {
		console.error("Timeout waiting for screenshots.");
		process.exit(1);
	}, 35000);
}

main().catch(err => {
	console.error("Screenshot capture failed:", err);
	process.exit(1);
});
