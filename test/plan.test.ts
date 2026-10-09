import { describe, expect, it } from 'vitest';
import { childEnv, pickRepo, planLaunch, type Env } from '../src/plan.js';
import { readProfile } from '../src/profile.js';

const dirs = new Set(['/w/app', '/r/web', '/w']);
const written: Record<string, string> = {};
const env = (files: Record<string, string>): Env => ({
  cwd: '/w',
  dataDir: '/d',
  roots: ['/r'],
  isDir: (p) => dirs.has(p),
  read: (p) => files[p],
  writeOnce: (p, t) => {
    written[p] = t;
  },
});
const reader = (m: Record<string, string>) => (p: string) => m[p];

describe('readProfile', () => {
  it('appends CLAUDE.md and excludes it by exact path', () => {
    expect(readProfile('/w', reader({ '/w/CLAUDE.md': 'rules' }))).toEqual({ append: 'rules', excludes: ['/w/CLAUDE.md'] });
  });
  it('excludes both files but appends identical text (symlinked AGENTS.md) once', () => {
    expect(readProfile('/w', reader({ '/w/CLAUDE.md': 'r', '/w/AGENTS.md': 'r' }))).toEqual({ append: 'r', excludes: ['/w/CLAUDE.md', '/w/AGENTS.md'] });
  });
  it('appends distinct AGENTS.md text too', () => {
    expect(readProfile('/w', reader({ '/w/CLAUDE.md': 'a', '/w/AGENTS.md': 'b' }))?.append).toBe('a\n\nb');
  });
  it('returns nothing when there is no instruction file, or it is empty', () => {
    expect(readProfile('/w', reader({}))).toBeUndefined();
    expect(readProfile('/w', reader({ '/w/CLAUDE.md': '' }))).toBeUndefined();
  });
});

describe('pickRepo', () => {
  it('uses a first arg naming a directory under the cwd or a root, and drops it from the claude args', () => {
    expect(pickRepo(['app', '-c'], env({}))).toEqual({ cwd: '/w/app', rest: ['-c'] });
    expect(pickRepo(['web'], env({}))).toEqual({ cwd: '/r/web', rest: [] });
  });
  it('keeps flags and unknown words for claude and stays in the cwd', () => {
    expect(pickRepo(['-p', 'hi'], env({}))).toEqual({ cwd: '/w', rest: ['-p', 'hi'] });
    expect(pickRepo(['nope'], env({}))).toEqual({ cwd: '/w', rest: ['nope'] });
    expect(pickRepo([], env({}))).toEqual({ cwd: '/w', rest: [] });
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
