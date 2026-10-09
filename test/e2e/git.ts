import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Hermetic git: no user config, fixed identity. */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

/** One repo and its worktrees, in every layout people use. All share the committed CLAUDE.md. */
export interface Repos {
  base: string;
  main: string;
  /** Sibling of main, other branch, with an uncommitted file so `git status` really differs. */
  wt: string;
  /** Sibling of main, clean. */
  wt2: string;
  /** Inside the main repo, the way Claude Code places its own worktrees (`.claude/worktrees/<name>`). */
  nested: string;
  /** In an unrelated folder tree, like `~/worktrees/<repo>/<task>`. */
  far: string;
}

/**
 * A real git repo with a committed CLAUDE.md (AGENTS.md symlinked to it), a `src/` subfolder,
 * any `extra` files committed alongside, and four real worktrees.
 */
export function makeRepos(claudeMd: string, extra: Record<string, string> = {}): Repos {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cw-git-')));
  const main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries({ 'CLAUDE.md': claudeMd, 'src/app.txt': 'hello', ...extra })) {
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), text);
  }
  symlinkSync('CLAUDE.md', join(main, 'AGENTS.md'));
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  appendFileSync(join(main, '.git/info/exclude'), '.claude/worktrees/\n');
  const repos = { base, main, wt: join(base, 'wt-feature'), wt2: join(base, 'wt-other'), nested: join(main, '.claude/worktrees/nested'), far: join(base, 'elsewhere/deep/far') };
  git(main, 'worktree', 'add', '-q', '-b', 'feature-x', repos.wt);
  git(main, 'worktree', 'add', '-q', '-b', 'other-y', repos.wt2);
  git(main, 'worktree', 'add', '-q', '-b', 'nested-z', repos.nested);
  git(main, 'worktree', 'add', '-q', '-b', 'far-w', repos.far);
  writeFileSync(join(repos.wt, 'uncommitted.txt'), 'dirty');
  return repos;
}
