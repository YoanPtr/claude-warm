import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Real Claude Code, real API, a few cents: `CW_E2E_REAL=1 npm run e2e:real`.
 * Two folders with the same CLAUDE.md. The second folder under cw must write far fewer cache tokens than under plain claude.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cw = resolve(here, '../../dist/main.js');
const claudeMd = '# Demo rules\n' + Array.from({ length: 2500 }, (_, i) => `- Rule ${i}: keep tests small, name things well, review before merging item ${i * 7919}.`).join('\n');

function run(bin: string, args: string[], cwd: string): { written: number; read: number } {
  const r = spawnSync(bin, [...args, '-p', 'reply with: ok', '--model', 'haiku', '--output-format', 'json', '--max-budget-usd', '0.5'], { cwd, encoding: 'utf8', input: '' });
  const u = JSON.parse(r.stdout).usage;
  return { written: u.cache_creation_input_tokens, read: u.cache_read_input_tokens };
}

describe.skipIf(!process.env.CW_E2E_REAL)('real claude: cache reuse across sibling folders', () => {
  it('writes at least 5x fewer tokens on the second folder than plain claude does', () => {
    const base = mkdtempSync(join(tmpdir(), 'cw-real-'));
    const [a, b] = ['a', 'b'].map((n) => {
      mkdirSync(join(base, n));
      writeFileSync(join(base, n, 'CLAUDE.md'), claudeMd);
      return join(base, n);
    }) as [string, string];
    run('claude', [], a);
    const plain = run('claude', [], b);
    run('node', [cw], a);
    const warm = run('node', [cw], b);
    console.log({ plain, warm });
    expect(warm.written * 5).toBeLessThan(plain.written);
  }, 300_000);
});
