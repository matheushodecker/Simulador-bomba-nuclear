/**
 * Gera a edição "artefato" (página isolada do claude.ai, sem serviços externos):
 *   npm run build:artifact  →  dist-artifact/artifact.html + dist-artifact/assets/*
 * O claude.ai envolve a página no próprio <html>/<head>/<body>, então retiramos essas tags.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execSync('npx vite build --mode artifact --outDir dist-artifact --emptyOutDir', { stdio: 'inherit' });
let html = readFileSync('dist-artifact/index.html', 'utf8');
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<html[^>]*>/i, '')
  .replace(/<\/html>/i, '')
  .replace(/<head>/i, '')
  .replace(/<\/head>/i, '')
  .replace(/<body>/i, '')
  .replace(/<\/body>/i, '')
  .replace(/<meta charset="utf-8" \/>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
// o <title> precisa estar nos primeiros 8 KB
const m = html.match(/<title>[\s\S]*?<\/title>/);
if (m) html = `${m[0]}\n${html.replace(m[0], '')}`;
writeFileSync('dist-artifact/artifact.html', html.trim() + '\n');
console.log('dist-artifact/artifact.html pronto');
