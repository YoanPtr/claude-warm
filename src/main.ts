#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { childEnv, planLaunch, type Env } from './plan.js';

const env: Env = {
  cwd: process.cwd(),
  dataDir: process.env.CW_HOME || join(homedir(), '.claude-warm'),
  roots: (process.env.CW_ROOTS ?? '').split(delimiter).filter(Boolean),
  isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
  read: (p) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : undefined),
  writeOnce: (p, text) => {
    if (existsSync(p)) return;
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    writeFileSync(p, text, { mode: 0o600 });
  },
};

const plan = planLaunch(process.argv.slice(2), env);
const bin = process.env.CW_CLAUDE || 'claude';

if (process.env.CW_DRY_RUN) {
  console.log(JSON.stringify({ bin, cwd: plan.cwd, args: plan.args }, null, 2));
} else {
  // The terminal sends Ctrl-C to the whole foreground group: claude handles it, this wrapper must not die first.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => undefined);
  const child = spawn(bin, plan.args, { cwd: plan.cwd, stdio: 'inherit', env: childEnv(process.env), shell: process.platform === 'win32' });
  child.on('error', (e) => {
    console.error(`cw: cannot start ${bin}: ${e.message}`);
    process.exitCode = 127;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 128 : 1);
  });
}
