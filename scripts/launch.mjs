import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(new URL('../dist/electron/main.cjs', import.meta.url))) {
  console.error('Build HARMONY first: npm run build'); process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root], { cwd: root, env, stdio: 'inherit' });
child.on('error', () => { console.error('Could not launch HARMONY.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
