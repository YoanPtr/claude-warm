import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hermetic git: no user config, fixed identity. */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

export interface Repos {
  base: string;
  main: string;
  /** Second worktree, other branch, with an uncommitted file so `git status` really differs. */
  wt: string;
  /** Third worktree, clean, for tests that need two siblings of the main repo. */
  wt2: string;
}

/** A real git repo with a committed CLAUDE.md (AGENTS.md symlinked to it) and two real sibling worktrees. */
export function makeRepos(claudeMd: string): Repos {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cw-git-')));
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'CLAUDE.md'), claudeMd);
  symlinkSync('CLAUDE.md', join(main, 'AGENTS.md'));
  writeFileSync(join(main, 'app.txt'), 'hello');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = join(base, 'wt-feature');
  const wt2 = join(base, 'wt-other');
  git(main, 'worktree', 'add', '-q', '-b', 'feature-x', wt);
  git(main, 'worktree', 'add', '-q', '-b', 'other-y', wt2);
  writeFileSync(join(wt, 'uncommitted.txt'), 'dirty');
  return { base, main, wt, wt2 };
}
