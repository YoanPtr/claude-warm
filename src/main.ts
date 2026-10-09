#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { childEnv, planLaunch, type Env } from './plan.js';

const env: Env = {
  cwd: process.cwd(),
  dataDir: process.env.CW_HOME || join(homedir(), '.claude-warm'),
  roots: (process.env.CW_ROOTS ?? '').split(delimiter).filter(Boolean),
  home: homedir(),
  isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
  read: (p) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : undefined),
  writeOnce: (p, text) => {
    if (existsSync(p)) return;
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    // Write then rename: a crash mid-write must never leave a truncated file under the content hash.
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, p);
  },
};

const plan = planLaunch(process.argv.slice(2), env);
const bin = process.env.CW_CLAUDE || 'claude';

if (process.env.CW_DRY_RUN) {
  console.log(JSON.stringify({ bin, cwd: plan.cwd, args: plan.args }, null, 2));
} else {
  const child = spawn(bin, plan.args, { cwd: plan.cwd, stdio: 'inherit', env: childEnv(process.env), shell: process.platform === 'win32' });
  // The terminal sends Ctrl-C to the whole foreground group: claude handles it, this wrapper must not die first.
  process.on('SIGINT', () => undefined);
  // SIGTERM and SIGHUP can target the wrapper alone (`kill`, a closed tab): pass them on so claude is not orphaned.
  for (const sig of ['SIGTERM', 'SIGHUP'] as const) process.on(sig, () => child.kill(sig));
  child.on('error', (e) => {
    console.error(`cw: cannot start ${bin}: ${e.message}`);
    process.exitCode = 127;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? 128 + (signal ? constants.signals[signal] : 0);
  });
}
