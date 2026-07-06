import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const path = join(process.cwd(), 'data', 'raw', 'BTCUSDT_4h.json');
if (existsSync(path)) {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    console.log(`Total candles in BTCUSDT_4h.json: ${data.length}`);
    if (data.length > 0) {
        console.log(`First candle: ${new Date(data[0].openTime).toISOString()}`);
        console.log(`Last candle : ${new Date(data[data.length - 1].openTime).toISOString()}`);
    }
} else {
    console.log("File not found.");
}
