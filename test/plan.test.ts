import { describe, expect, it } from 'vitest';
import { childEnv, instructionDirs, pickRepo, planLaunch, type Env } from '../src/plan.js';
import { importsOf, readProfile } from '../src/profile.js';

const dirs = new Set(['/w/app', '/r/web', '/w', '/abs/repo']);
const written: Record<string, string> = {};
const env = (files: Record<string, string>): Env => ({
  cwd: '/w',
  dataDir: '/d',
  roots: ['/r'],
  home: '/h',
  isDir: (p) => dirs.has(p),
  read: (p) => files[p],
  writeOnce: (p, t) => {
    written[p] = t;
  },
});
const io = (m: Record<string, string>) => ({ read: (p: string) => m[p], home: '/h' });

describe('readProfile', () => {
  it('appends CLAUDE.md and excludes it by exact path', () => {
    expect(readProfile(['/w'], io({ '/w/CLAUDE.md': 'rules' }))).toEqual({ append: 'rules', excludes: ['/w/CLAUDE.md'] });
  });
  it('excludes both files but appends identical text (symlinked AGENTS.md) once', () => {
    expect(readProfile(['/w'], io({ '/w/CLAUDE.md': 'r', '/w/AGENTS.md': 'r' }))).toEqual({ append: 'r', excludes: ['/w/CLAUDE.md', '/w/AGENTS.md'] });
  });
  it('appends distinct AGENTS.md text too', () => {
    expect(readProfile(['/w'], io({ '/w/CLAUDE.md': 'a', '/w/AGENTS.md': 'b' }))?.append).toBe('a\n\nb');
  });
  it('reads .claude/CLAUDE.md as well', () => {
    expect(readProfile(['/w'], io({ '/w/.claude/CLAUDE.md': 'r' }))?.excludes).toEqual(['/w/.claude/CLAUDE.md']);
  });
  it('returns nothing when there is no instruction file, or it is empty', () => {
    expect(readProfile(['/w'], io({}))).toBeUndefined();
    expect(readProfile(['/w'], io({ '/w/CLAUDE.md': '' }))).toBeUndefined();
  });
  it('puts the repo root first, then the subfolder', () => {
    const p = readProfile(['/w', '/w/sub'], io({ '/w/CLAUDE.md': 'root', '/w/sub/CLAUDE.md': 'sub' }));
    expect(p).toEqual({ append: 'root\n\nsub', excludes: ['/w/CLAUDE.md', '/w/sub/CLAUDE.md'] });
  });
});

describe('@imports', () => {
  it('finds tokens at line start or after a space, never in code or e-mail addresses', () => {
    expect(importsOf('@a.md see @docs/b.md\n`@c.md`\n```\n@d.md\n```\nme@mail.com')).toEqual(['a.md', 'docs/b.md']);
  });
  it('inlines imports (nested, relative to the importing file, ~ from home), labelled repo-relative', () => {
    const p = readProfile(['/w'], io({ '/w/CLAUDE.md': 'main @docs/a.md @~/me.md', '/w/docs/a.md': 'A @b.md', '/w/docs/b.md': 'B', '/h/me.md': 'ME' }));
    expect(p?.append).toBe(
      'main @docs/a.md @~/me.md\n\nContents of docs/a.md (imported):\n\nA @b.md\n\nContents of docs/b.md (imported):\n\nB\n\nContents of /h/me.md (imported):\n\nME',
    );
    expect(p?.excludes).toEqual(['/w/CLAUDE.md']);
  });
  it('gives the same text for the same files in two worktrees (labels do not hold the worktree path)', () => {
    const a = readProfile(['/x/wt1'], io({ '/x/wt1/CLAUDE.md': '@a.md', '/x/wt1/a.md': 'A' }));
    const b = readProfile(['/y/z/wt2'], io({ '/y/z/wt2/CLAUDE.md': '@a.md', '/y/z/wt2/a.md': 'A' }));
    expect(a?.append).toBe(b?.append);
  });
  it('ignores missing targets, stops cycles, and does not re-append the instruction files (CLAUDE.md = "@AGENTS.md")', () => {
    const p = readProfile(['/w'], io({ '/w/CLAUDE.md': '@AGENTS.md @someone', '/w/AGENTS.md': 'rules @x.md', '/w/x.md': '@AGENTS.md @x.md' }));
    expect(p?.append).toBe('@AGENTS.md @someone\n\nrules @x.md\n\nContents of x.md (imported):\n\n@AGENTS.md @x.md');
  });
  it('follows at most 5 hops, like Claude Code', () => {
    const files: Record<string, string> = { '/w/CLAUDE.md': '@1.md' };
    for (let i = 1; i <= 7; i++) files[`/w/${i}.md`] = `n${i} @${i + 1}.md`;
    const text = readProfile(['/w'], io(files))?.append ?? '';
    expect(text).toContain('n5');
    expect(text).not.toContain('n6');
  });
});

describe('pickRepo', () => {
  it('uses a first arg naming a directory under the cwd, a root, or an absolute path, and drops it from the claude args', () => {
    expect(pickRepo(['app', '-c'], env({}))).toEqual({ cwd: '/w/app', rest: ['-c'] });
    expect(pickRepo(['web'], env({}))).toEqual({ cwd: '/r/web', rest: [] });
    expect(pickRepo(['/abs/repo', '-c'], env({}))).toEqual({ cwd: '/abs/repo', rest: ['-c'] });
  });
  it('keeps flags and unknown words for claude and stays in the cwd', () => {
    expect(pickRepo(['-p', 'hi'], env({}))).toEqual({ cwd: '/w', rest: ['-p', 'hi'] });
    expect(pickRepo(['nope'], env({}))).toEqual({ cwd: '/w', rest: ['nope'] });
    expect(pickRepo([], env({}))).toEqual({ cwd: '/w', rest: [] });
  });
});

describe('instructionDirs', () => {
  const isDir = (p: string) => p === '/repo/.git';
  it('walks up to the main repo (.git folder) or a worktree (.git file); the folders above are "outer"', () => {
    expect(instructionDirs('/repo/src/deep', { isDir, read: () => undefined })).toEqual({ repo: ['/repo', '/repo/src', '/repo/src/deep'], outer: ['/'] });
    const read = (p: string) => (p === '/repo/.wt/x/.git' ? 'gitdir: /repo/.git/worktrees/x' : undefined);
    expect(instructionDirs('/repo/.wt/x/src', { isDir, read })).toEqual({ repo: ['/repo/.wt/x', '/repo/.wt/x/src'], outer: ['/repo/.wt', '/repo', '/'] });
  });
  it('outside a repo, only the cwd', () => {
    expect(instructionDirs('/tmp/a', { isDir, read: () => undefined })).toEqual({ repo: ['/tmp/a'], outer: ['/tmp', '/'] });
  });
});

describe('outer folders', () => {
  it('excludes an outer file with the same text (nested worktree) without changing the appended text', () => {
    const files = { '/m/.wt/x/CLAUDE.md': 'rules', '/m/CLAUDE.md': 'rules', '/CLAUDE.md': 'personal' };
    expect(readProfile(['/m/.wt/x'], io(files), ['/m/.wt', '/m', '/'])).toEqual({ append: 'rules', excludes: ['/m/.wt/x/CLAUDE.md', '/m/CLAUDE.md'] });
  });
  it('planLaunch uses it: a worktree nested in its main repo', () => {
    const files = { '/w/app/.git': 'gitdir: x', '/w/app/CLAUDE.md': 'same', '/w/CLAUDE.md': 'same' };
    expect(JSON.parse(planLaunch(['app'], env(files)).args[4] as string).claudeMdExcludes).toEqual(['/w/app/CLAUDE.md', '/w/CLAUDE.md']);
  });
});

describe('planLaunch', () => {
  it('builds the three flags, writes the text once under a content hash, and keeps the user args last', () => {
    const p = planLaunch(['app', '--model', 'haiku'], env({ '/w/app/CLAUDE.md': 'rules' }));
    expect(p.cwd).toBe('/w/app');
    expect(p.args).toEqual([
      '--append-system-prompt-file',
      expect.stringMatching(/^\/d\/[0-9a-f]{16}\.md$/),
      '--exclude-dynamic-system-prompt-sections',
      '--settings',
      '{"claudeMdExcludes":["/w/app/CLAUDE.md"]}',
      '--model',
      'haiku',
    ]);
    expect(written[p.args[1] as string]).toBe('rules');
  });
  it('gives the same file for the same text in two repos (that is the cache hit)', () => {
    const a = planLaunch(['app'], env({ '/w/app/CLAUDE.md': 'same' }));
    const b = planLaunch(['web'], env({ '/r/web/CLAUDE.md': 'same' }));
    expect(a.args[1]).toBe(b.args[1]);
  });
  it('passes args through untouched without an instruction file', () => {
    expect(planLaunch(['-c'], env({}))).toEqual({ cwd: '/w', args: ['-c'] });
  });
});

describe('childEnv', () => {
  it('adds NAME=value pairs from CW_ENV and ignores junk', () => {
    expect(childEnv({ A: '1', CW_ENV: 'X=a=b  Y=2 junk' })).toMatchObject({ A: '1', X: 'a=b', Y: '2' });
    expect(childEnv({ A: '1' })).toEqual({ A: '1' });
  });
});
