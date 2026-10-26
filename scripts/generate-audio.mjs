// Optional authoring tool. Reading the app still requires only a static server.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { collectAudio } from './lib/audio.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const force = args.includes('--force');
const dirs = args.filter((a) => a !== '--force');
try {
  if (!dirs.length) {
    const { stories } = JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8'));
    dirs.push(...stories.map((id) => resolve(root, 'content', id)));
  }
  const books = await Promise.all(dirs.map(async (dir) => ({
    dir: resolve(dir), entries: await collectAudio(resolve(dir)),
  })));
  const child = spawn('uv', ['run', '--script', fileURLToPath(new URL('synthesize-audio.py', import.meta.url))], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.on('error', (err) => {
    console.error(`Cannot start uv: ${err.message}. Install uv: https://docs.astral.sh/uv/getting-started/installation/`);
    process.exitCode = 1;
  });
  child.stdin.on('error', () => {}); // A failed subprocess is reported above/by its exit code.
  child.stdin.end(JSON.stringify({ books, force }));
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
