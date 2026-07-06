import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function getAllFiles(dirPath, arrayOfFiles = []) {
	const files = readdirSync(dirPath);

	for (const file of files) {
		const fullPath = join(dirPath, file);
		if (statSync(fullPath).isDirectory()) {
			getAllFiles(fullPath, arrayOfFiles);
		} else {
			// Include only .ts, .html, .js files, and exclude node_modules, git, results, scratch, npm-cache
			if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.json')) {
				if (!fullPath.includes('node_modules') && !fullPath.includes('.git') && !fullPath.includes('.npm-cache') && !fullPath.includes('package-lock.json')) {
					arrayOfFiles.push(fullPath);
				}
			}
		}
	}

	return arrayOfFiles;
}

const rootDir = '/Users/erdemaslan/.gemini/antigravity/scratch/kriptoquant';
const srcDir = join(rootDir, 'src');

console.log('Finding all source files...');
const files = getAllFiles(srcDir);

// Also add typescript config and package.json from root
files.push(join(rootDir, 'package.json'));
files.push(join(rootDir, 'tsconfig.json'));

let output = '';

for (const file of files) {
	const relPath = relative(rootDir, file);
	console.log(`Processing: ${relPath}`);
	
	output += '\n';
	output += '='.repeat(100) + '\n';
	output += `FILE: ${relPath}\n`;
	output += '='.repeat(100) + '\n\n';
	
	try {
		const content = readFileSync(file, 'utf-8');
		output += content;
		output += '\n';
	} catch (e) {
		output += `[Error reading file: ${e.message}]\n`;
	}
}

const outputPath = join(rootDir, 'kriptoquant_all_source_code.txt');
writeFileSync(outputPath, output, 'utf-8');
console.log(`Successfully concatenated all source code to: ${outputPath}`);
