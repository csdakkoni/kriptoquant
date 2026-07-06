import http from 'node:http';

http.get('http://localhost:3008/api/live-paper', (res) => {
	let data = '';
	res.on('data', (chunk) => { data += chunk; });
	res.on('end', () => {
		console.log("=== LIVE ENGINE STATE ===");
		console.log(JSON.stringify(JSON.parse(data), null, 4));
	});
}).on('error', (err) => {
	console.error("Error connecting to server:", err.message);
});
