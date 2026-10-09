import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { git, makeRepos } from './git.js';

/**
 * Real Claude Code, real API, real git repo and worktrees. A few dollars at most: `npm run e2e:real`.
 * Needs `claude` on PATH and logged in. Skipped unless CW_E2E_REAL is set.
 */
const cw = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/main.js');
const CODEWORD = 'PINEAPPLE-4217';
const claudeMd =
  `# Demo rules\nThe project codeword is ${CODEWORD}. When asked for the codeword, answer with it.\n` +
  Array.from({ length: 2500 }, (_, i) => `- Rule ${i}: keep tests small, name things well, review before merging item ${i * 7919}.`).join('\n');

interface Result {
  text: string;
  written: number;
  read: number;
  input: number;
}

function ask(runner: 'plain' | 'cw', cwd: string, prompt: string): Result {
  const [bin, pre] = runner === 'plain' ? ['claude', []] : ['node', [cw]];
  const r = spawnSync(bin, [...pre, '-p', prompt, '--model', 'haiku', '--output-format', 'json', '--max-budget-usd', '0.5'], { cwd, encoding: 'utf8', input: '' });
  if (r.status !== 0) throw new Error(`${runner} failed (${r.status}): ${r.stderr || r.stdout}`);
  const d = JSON.parse(r.stdout);
  return { text: String(d.result), written: d.usage.cache_creation_input_tokens, read: d.usage.cache_read_input_tokens, input: d.usage.input_tokens };
}

const total = (r: Result) => r.written + r.read + r.input;

describe.skipIf(!process.env.CW_E2E_REAL)('real claude, real git worktrees', () => {
  const repos = makeRepos(claudeMd);
  afterAll(() => rmSync(repos.base, { recursive: true, force: true }));

  it('the second worktree writes at least 5x fewer cache tokens than plain claude', () => {
    ask('plain', repos.wt, 'reply with: ok');
    const plain = ask('plain', repos.wt2, 'reply with: ok');
    ask('cw', repos.wt, 'reply with: ok');
    const warm = ask('cw', repos.wt2, 'reply with: ok');
    console.log({ plain, warm });
    expect(warm.written * 5).toBeLessThan(plain.written);
  }, 400_000);

  it('does not load CLAUDE.md twice: total prompt size stays within 3% of plain claude', () => {
    const plain = ask('plain', repos.main, 'reply with: ok');
    const warm = ask('cw', repos.main, 'reply with: ok');
    expect(total(warm)).toBeLessThan(total(plain) * 1.03);
  }, 300_000);

  it('claude still follows the instructions (they arrive in the system prompt)', () => {
    expect(ask('cw', repos.wt, 'What is the project codeword? Answer with the codeword only.').text).toContain(CODEWORD);
  }, 120_000);

  it('claude still knows its working folder, branch and dirty files (moved to the first message)', () => {
    const text = ask('cw', repos.wt, 'Without running any tool: what git branch are you on, and is there an uncommitted file? Answer in one short sentence.').text;
    expect(text).toContain('feature-x');
    expect(text.toLowerCase()).toContain('uncommitted');
  }, 120_000);

  it('picks up an edit to CLAUDE.md on the next session', () => {
    writeFileSync(`${repos.wt2}/CLAUDE.md`, claudeMd.replace(CODEWORD, 'MANGO-9001'));
    git(repos.wt2, 'commit', '-qam', 'new codeword');
    expect(ask('cw', repos.wt2, 'What is the project codeword? Answer with the codeword only.').text).toContain('MANGO-9001');
  }, 120_000);
});
