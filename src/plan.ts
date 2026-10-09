import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readProfile } from './profile.js';

export interface Env {
  /** Directory `cw` was started in. */
  cwd: string;
  /** Where the instruction text files are kept (default `~/.claude-warm`). */
  dataDir: string;
  /** Folders searched for `cw <repo>`, after the cwd. */
  roots: string[];
  isDir: (path: string) => boolean;
  read: (path: string) => string | undefined;
  /** Writes `text` to `path` (mode 600, parent created) unless it is already there. */
  writeOnce: (path: string, text: string) => void;
}

export interface Plan {
  cwd: string;
  args: string[];
}

/** First arg is a repo when it is not a flag and names a directory (under the cwd, or under a root). */
export function pickRepo(args: string[], env: Pick<Env, 'cwd' | 'roots' | 'isDir'>): { cwd: string; rest: string[] } {
  const [first, ...rest] = args;
  if (first === undefined || first.startsWith('-')) return { cwd: env.cwd, rest: args };
  const dir = [join(env.cwd, first), ...env.roots.map((r) => join(r, first))].find((d) => env.isDir(d));
  return dir === undefined ? { cwd: env.cwd, rest: args } : { cwd: dir, rest };
}

/**
 * Three flags, each needed (see README "How it works"):
 * - `--append-system-prompt-file`: the instructions ride in the cached system prompt.
 * - `--settings {claudeMdExcludes}`: Claude Code must not load the same files again in the first message.
 * - `--exclude-dynamic-system-prompt-sections`: cwd and git status leave the system prompt, so sibling worktrees share a prefix.
 */
export function planLaunch(args: string[], env: Env): Plan {
  const { cwd, rest } = pickRepo(args, env);
  const profile = readProfile(cwd, env.read);
  if (!profile) return { cwd, args: rest };
  const hash = createHash('sha256').update(profile.append).digest('hex').slice(0, 16);
  const file = join(env.dataDir, `${hash}.md`);
  env.writeOnce(file, profile.append);
  return {
    cwd,
    args: [
      '--append-system-prompt-file',
      file,
      '--exclude-dynamic-system-prompt-sections',
      '--settings',
      JSON.stringify({ claudeMdExcludes: profile.excludes }),
      ...rest,
    ],
  };
}

/** `CW_ENV="NAME=value OTHER=1"`: extra variables for the child only. Entries without `=` are ignored. */
export function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const extra = (base.CW_ENV ?? '').split(/\s+/).filter((e) => e.includes('='));
  return Object.fromEntries([...Object.entries(base), ...extra.map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)] as const)]);
}
