import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(repo, 'apps/web');
const files = (await readdir(path.join(web, 'src/lib'), { recursive: true }))
  .filter(file => file.endsWith('.test.ts')).sort().map(file => path.join('src/lib', file));
const child = spawn(process.execPath, ['--conditions=react-server','--test','--test-reporter=spec',...files],
  { cwd: web, stdio: ['ignore','pipe','pipe'] });
let output = '';
for (const stream of [child.stdout,child.stderr]) stream.on('data', chunk => { output += chunk; });
const exit = await new Promise((resolve,reject) => { child.on('error',reject); child.on('close',resolve); });
await mkdir(path.join(repo,'.artifacts'), { recursive: true });
await writeFile(path.join(repo,'.artifacts','cleanup-web-tests.log'),output);
const lines = output.split('\n');
console.log(lines.filter(line => line.startsWith('\u2139') || line.startsWith('\u2716') ||
  line.includes('AssertionError') || line.includes('error:')).join('\n'));
if (exit) console.log(output.slice(output.lastIndexOf('failing tests:')));
console.log(`Saved full test output to .artifacts/cleanup-web-tests.log. Exit ${exit}.`);
process.exitCode = exit;
