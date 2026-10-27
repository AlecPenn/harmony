import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// HARMONY_OUT lets the updater build beside the running version (dist-next) instead of over it.
const out = resolve(process.env.HARMONY_OUT || 'dist');
await viteBuild({ build: { outDir: join(out, 'renderer'), emptyOutDir: true } });
for (const name of ['main', 'preload']) {
  await bundle({
    entryPoints: [`apps/desktop/electron/${name}.ts`],
    outfile: join(out, 'electron', `${name}.cjs`), bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron']
  });
}
// Which commit this build is, so HARMONY can tell when there's something newer (read from .git; no git needed).
function head() {
  try {
    const h = readFileSync('.git/HEAD', 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(h)) return h;
    const ref = h.match(/^ref: (refs\/[\w./-]+)$/)?.[1];
    try { const v = readFileSync(join('.git', ref), 'utf8').trim(); if (/^[0-9a-f]{40}$/.test(v)) return v; } catch {}
    for (const line of readFileSync('.git/packed-refs', 'utf8').split('\n')) { const [sha, name] = line.trim().split(' '); if (name === ref) return sha; }
  } catch {}
  return null;
}
const commit = /^[0-9a-f]{40}$/.test(process.env.HARMONY_COMMIT ?? '') ? process.env.HARMONY_COMMIT : head();
writeFileSync(join(out, 'build-info.json'), JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 1));
console.log('HARMONY desktop build ready.');
