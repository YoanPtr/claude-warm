import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { git, makeRepos, type Repos } from './git.js';

/**
 * Real Claude Code, real API, real git repo and worktrees in every layout, print mode and the interactive REPL. About $0.80 on haiku: `npm run e2e:real`.
 * Needs `claude` on PATH and logged in. Skipped unless CW_E2E_REAL is set.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cw = resolve(here, '../../dist/main.js');
const CODEWORD = 'PINEAPPLE-4217';
const IMPORTED = 'KIWI-5521';
const claudeMd =
  `# Demo rules\nThe project codeword is ${CODEWORD}. When asked for the codeword, answer with it.\nThe deploy word is in @docs/deploy.md\n` +
  Array.from({ length: 2500 }, (_, i) => `- Rule ${i}: keep tests small, name things well, review before merging item ${i * 7919}.`).join('\n');

interface Result {
  text: string;
  written: number;
  read: number;
  input: number;
}

/** Async, so a long session never blocks the vitest worker. stdin is closed, as in a script. */
function run(bin: string, args: string[], cwd: string): Promise<{ status: number | null; out: string; err: string }> {
  return new Promise((ok) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('close', (status) => ok({ status, out, err }));
  });
}

const cmd = (runner: 'plain' | 'cw') => (runner === 'plain' ? ['claude'] : [process.execPath, cw]);

async function ask(runner: 'plain' | 'cw', cwd: string, prompt = 'reply with: ok'): Promise<Result> {
  const [bin, ...pre] = cmd(runner) as [string, ...string[]];
  const r = await run(bin, [...pre, '-p', prompt, '--model', 'haiku', '--output-format', 'json', '--max-budget-usd', '0.5'], cwd);
  if (r.status !== 0) throw new Error(`${runner} failed (${r.status}): ${r.err || r.out}`);
  const d = JSON.parse(r.out);
  return { text: String(d.result), written: d.usage.cache_creation_input_tokens, read: d.usage.cache_read_input_tokens, input: d.usage.input_tokens };
}

/** One real REPL session in a pseudo-terminal (python3 pty); returns the first turn's cache writes. */
async function askInteractive(runner: 'plain' | 'cw', cwd: string): Promise<number> {
  const r = await run('python3', [join(here, 'interactive.py'), cwd, ...cmd(runner), '--model', 'haiku'], cwd);
  if (r.status !== 0) throw new Error(`interactive ${runner} failed: ${r.err || r.out}`);
  return JSON.parse(r.out).written;
}

const total = (r: Result) => r.written + r.read + r.input;

/** Claude Code keeps a transcript folder per working folder; drop the ones these temp repos created. */
function removeTranscripts(base: string): void {
  const projects = join(homedir(), '.claude/projects');
  const prefix = base.replace(/[^a-zA-Z0-9]/g, '-');
  if (!existsSync(projects)) return;
  for (const d of readdirSync(projects)) if (d.startsWith(prefix)) rmSync(join(projects, d), { recursive: true, force: true });
}

describe.skipIf(!process.env.CW_E2E_REAL)('real claude, real git worktrees', () => {
  let repos: Repos;
  beforeAll(() => {
    repos = makeRepos(claudeMd, { 'docs/deploy.md': `The deploy word is ${IMPORTED}.` });
  });
  afterAll(() => {
    rmSync(repos.base, { recursive: true, force: true });
    removeTranscripts(repos.base);
  });

  it('every worktree layout reuses the cache: each writes at least 5x fewer tokens than plain claude', async () => {
    await ask('plain', repos.main);
    const plain = await ask('plain', repos.wt2);
    await ask('cw', repos.main);
    const places = { sibling: repos.wt2, dirty: repos.wt, nested: repos.nested, far: repos.far, subfolder: join(repos.far, 'src') };
    const warm: Record<string, number> = {};
    for (const [name, dir] of Object.entries(places)) warm[name] = (await ask('cw', dir)).written;
    console.log({ plainWritten: plain.written, warm });
    for (const written of Object.values(warm)) expect(written * 5).toBeLessThan(plain.written);
  }, 600_000);

  it('interactive sessions (the REPL, not just -p) get the same saving', async () => {
    await askInteractive('plain', repos.main);
    const plain = await askInteractive('plain', repos.wt2);
    await askInteractive('cw', repos.nested);
    const warm = await askInteractive('cw', repos.far);
    console.log({ interactivePlain: plain, interactiveCw: warm });
    expect(warm * 5).toBeLessThan(plain);
  }, 300_000);

  it('does not load CLAUDE.md twice: total prompt size stays within 3% of plain claude', async () => {
    const plain = await ask('plain', repos.wt);
    const warm = await ask('cw', repos.wt);
    expect(total(warm)).toBeLessThan(total(plain) * 1.03);
  }, 300_000);

  it('claude still follows the instructions (they arrive in the system prompt)', async () => {
    expect((await ask('cw', repos.wt, 'What is the project codeword? Answer with the codeword only.')).text).toContain(CODEWORD);
  }, 120_000);

  it('claude still sees @imported files', async () => {
    expect((await ask('cw', repos.far, 'What is the deploy word? Answer with the word only, without using any tool.')).text).toContain(IMPORTED);
  }, 120_000);

  it('claude still knows its working folder, branch and dirty files (moved to the first message)', async () => {
    const text = (await ask('cw', repos.wt, 'Without running any tool: what git branch are you on, and is there an uncommitted file? Answer in one short sentence.')).text;
    expect(text).toContain('feature-x');
    expect(text.toLowerCase()).toMatch(/uncommitted|untracked/);
  }, 120_000);

  it('picks up an edit to CLAUDE.md on the next session', async () => {
    writeFileSync(`${repos.wt2}/CLAUDE.md`, claudeMd.replace(CODEWORD, 'MANGO-9001'));
    git(repos.wt2, 'commit', '-qam', 'new codeword');
    expect((await ask('cw', repos.wt2, 'What is the project codeword? Answer with the codeword only.')).text).toContain('MANGO-9001');
  }, 120_000);
});
