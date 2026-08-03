import { defineConfig } from 'vitest/config';
import { join } from 'node:path';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		// Testler gerçek organism-data'ya DOKUNMAMALI — izole geçici dizine yazarlar
		env: { ORGANISM_DATA_DIR: join(process.cwd(), '.test-organism-data') },
		fileParallelism: false,
	},
});
