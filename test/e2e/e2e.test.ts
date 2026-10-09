import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeRepos, type Repos } from './git.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fake = join(root, 'test/e2e/fake-claude.mjs');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cw-e2e-')));
let bin = '';
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

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

const outFile = () => join(tmp, `out-${Math.random().toString(36).slice(2)}.json`);
const fakeEnv = (out: string, extra: Record<string, string>) => ({ ...process.env, CW_CLAUDE: fake, CW_HOME: join(tmp, 'home'), FAKE_OUT: out, ...extra });

function cw(cwd: string, args: string[], extra: Record<string, string> = {}) {
  const out = outFile();
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', env: fakeEnv(out, extra) });
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

  it('accepts an absolute repo path', () => {
    const dir = repo('abs', 'x');
    expect(cw(repo('elsewhere'), [dir, '-c']).seen).toMatchObject({ cwd: dir, args: expect.arrayContaining(['-c']) });
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

  it('passes a SIGTERM sent to cw on to claude, and exits 128+15', async () => {
    const out = outFile();
    const child = spawn(bin, [], { cwd: repo('term', 'x'), env: fakeEnv(out, { FAKE_WAIT: '1' }) });
    const done = new Promise<number | null>((ok) => child.on('exit', (code) => ok(code)));
    while (!existsSync(out)) await new Promise((ok) => setTimeout(ok, 20));
    child.kill('SIGTERM');
    expect(await done).toBe(143);
  });
});

describe('with real git worktrees', () => {
  let repos: Repos;
  beforeAll(() => {
    repos = makeRepos('shared rules\n@docs/style.md', { 'docs/style.md': 'style guide' });
  });
  afterAll(() => rmSync(repos.base, { recursive: true, force: true }));
  const expected = 'shared rules\n@docs/style.md\n\nContents of docs/style.md (imported):\n\nstyle guide';

  it('runs in the worktree and excludes the worktree\'s own files, not the main repo\'s', () => {
    const { seen } = cw(repos.wt, ['-c']);
    expect(seen?.cwd).toBe(repos.wt);
    expect(JSON.parse(seen?.args[4] ?? '{}').claudeMdExcludes).toEqual([`${repos.wt}/CLAUDE.md`, `${repos.wt}/AGENTS.md`]);
  });

  it('appends the text once (AGENTS.md is a symlink) with its @import inlined', () => {
    expect(cw(repos.wt, []).seen?.appended).toBe(expected);
  });

  it('every worktree of the repo, wherever it lives, and any subfolder of one, gets the same file: one shared cache entry', () => {
    const places = [repos.main, repos.wt, repos.wt2, repos.nested, repos.far, join(repos.far, 'src'), join(repos.nested, 'src')];
    const files = places.map((d) => cw(d, []).seen?.args[1]);
    expect(files.every((f) => f !== undefined)).toBe(true);
    expect(new Set(files).size).toBe(1);
  });

  it('from a subfolder it stays there but excludes the worktree root\'s files', () => {
    const sub = join(repos.far, 'src');
    const { seen } = cw(sub, ['-c']);
    expect(seen?.cwd).toBe(sub);
    expect(JSON.parse(seen?.args[4] ?? '{}').claudeMdExcludes).toEqual([`${repos.far}/CLAUDE.md`, `${repos.far}/AGENTS.md`]);
    expect(seen?.appended).toBe(expected);
  });

  it('a worktree nested in the main repo also excludes the main CLAUDE.md that Claude Code would load from above', () => {
    expect(JSON.parse(cw(repos.nested, []).seen?.args[4] ?? '{}').claudeMdExcludes).toEqual([
      `${repos.nested}/CLAUDE.md`,
      `${repos.nested}/AGENTS.md`,
      `${repos.main}/CLAUDE.md`,
      `${repos.main}/AGENTS.md`,
    ]);
  });

  it('a worktree whose CLAUDE.md text differs gets its own file', () => {
    writeFileSync(join(repos.wt2, 'CLAUDE.md'), 'branch rules');
    expect(cw(repos.wt2, []).seen?.appended).toBe('branch rules');
    expect(cw(repos.wt, []).seen?.args[1]).not.toBe(cw(repos.wt2, []).seen?.args[1]);
  });
});
