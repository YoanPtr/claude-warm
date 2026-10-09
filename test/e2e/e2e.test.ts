import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fake = join(root, 'test/e2e/fake-claude.mjs');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cw-e2e-')));
let bin = '';

/** Install the PACKED tarball into a clean prefix, as a user would, and return the `cw` it provides. */
beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
  const name = execFileSync('npm', ['pack', '--pack-destination', tmp, '--silent'], { cwd: root }).toString().trim().split('\n').pop() as string;
  const prefix = join(tmp, 'prefix');
  mkdirSync(prefix);
  execFileSync('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', join(tmp, name)], { stdio: 'ignore' });
  bin = join(prefix, 'node_modules/.bin/cw');
}, 120_000);

function repo(name: string, claudeMd?: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  if (claudeMd !== undefined) writeFileSync(join(dir, 'CLAUDE.md'), claudeMd);
  return dir;
}

function cw(cwd: string, args: string[], extra: Record<string, string> = {}) {
  const out = join(tmp, `out-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', env: { ...process.env, CW_CLAUDE: fake, CW_HOME: join(tmp, 'home'), FAKE_OUT: out, ...extra } });
  let seen: { args: string[]; cwd: string; appended: string | null; seenEnv: string | null } | undefined;
  try {
    seen = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    seen = undefined;
  }
  return { ...r, seen };
}

describe('cw, installed from the packed tarball', () => {
  it('starts claude in the repo with the three flags, the text on disk, and the user args last', () => {
    const dir = repo('app', 'be kind');
    const { seen, status } = cw(tmp, ['app', '--model', 'haiku']);
    expect(status).toBe(0);
    expect(seen?.cwd).toBe(dir);
    expect(seen?.args).toEqual([
      '--append-system-prompt-file',
      expect.stringContaining(join(tmp, 'home')),
      '--exclude-dynamic-system-prompt-sections',
      '--settings',
      JSON.stringify({ claudeMdExcludes: [`${dir}/CLAUDE.md`] }),
      '--model',
      'haiku',
    ]);
    expect(seen?.appended).toBe('be kind');
  });

  it('uses the current folder when no repo is named', () => {
    const dir = repo('here', 'rules');
    expect(cw(dir, ['-c']).seen?.cwd).toBe(dir);
  });

  it('gives two sibling worktrees with the same text the same file (the cache key)', () => {
    repo('wt-a', 'same');
    repo('wt-b', 'same');
    expect(cw(tmp, ['wt-a']).seen?.args[1]).toBe(cw(tmp, ['wt-b']).seen?.args[1]);
  });

  it('changes nothing when there is no CLAUDE.md', () => {
    const dir = repo('bare');
    expect(cw(dir, ['-p', 'hi']).seen?.args).toEqual(['-p', 'hi']);
  });

  it('finds a repo under CW_ROOTS', () => {
    const dir = repo('rooted/proj', 'x');
    expect(cw(tmp, ['proj'], { CW_ROOTS: join(tmp, 'rooted') }).seen?.cwd).toBe(dir);
  });

  it('forwards the exit code of claude', () => {
    expect(cw(repo('exit', 'x'), [], { FAKE_EXIT: '7' }).status).toBe(7);
  });

  it('passes CW_ENV pairs to claude', () => {
    expect(cw(repo('env', 'x'), [], { CW_ENV: 'CW_TEST_VAR=hello' }).seen?.seenEnv).toBe('hello');
  });

  it('exits 127 with a clear message when claude is missing', () => {
    const r = cw(repo('missing', 'x'), [], { CW_CLAUDE: join(tmp, 'no-such-claude') });
    expect(r.status).toBe(127);
    expect(r.stderr).toContain('cw: cannot start');
  });

  it('CW_DRY_RUN prints the plan and starts nothing', () => {
    const r = cw(repo('dry', 'x'), ['-c'], { CW_DRY_RUN: '1' });
    expect(r.seen).toBeUndefined();
    expect(JSON.parse(r.stdout).args).toContain('--exclude-dynamic-system-prompt-sections');
  });
});
