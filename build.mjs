import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const assets = {};
for (const [path, file, type] of [
  ['/', 'index.html', 'text/html'], ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript']
]) assets[path] = [await readFile(file, 'utf8'), type];
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\n' + await readFile('worker.js', 'utf8'));
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
