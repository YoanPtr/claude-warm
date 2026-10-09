import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Project instruction files Claude Code loads from the folder it starts in. */
const FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md'];
/** Claude Code follows `@path` imports at most this many hops deep. */
const MAX_DEPTH = 5;

export interface Profile {
  /** Instruction text to append to the system prompt (identical files appear once, imports inlined). */
  append: string;
  /** Exact paths Claude Code must not load a second time (`claudeMdExcludes`). */
  excludes: string[];
}

export interface Reader {
  /** File text, or undefined when absent or not a file. */
  read: (path: string) => string | undefined;
  /** Home directory, for `@~/...` imports. */
  home: string;
}

interface Found {
  path: string;
  text: string;
}

/**
 * Reads the instruction files of `dirs` (repo root first, so the shared text leads the prompt).
 * Nothing found: undefined (plain `claude`).
 * AGENTS.md is often a symlink to CLAUDE.md, so identical text is appended once while both paths are excluded.
 * Claude Code no longer follows the `@imports` of an excluded file, so they are inlined here.
 * Files in `outer` folders are only excluded when their text is already appended (a nested worktree's
 * main repo); any other outer file keeps loading normally, so the appended text stays the same everywhere.
 */
export function readProfile(dirs: string[], io: Reader, outer: string[] = []): Profile | undefined {
  const found = filesIn(dirs, io);
  if (found.length === 0) return undefined;
  const root = dirs[0] as string;
  const texts = new Set(found.map((f) => f.text));
  const duplicates = filesIn(outer, io).filter((f) => texts.has(f.text));
  const seen = new Set(found.map((f) => f.path));
  const imported = found.flatMap((f) => expand(f, 1, seen, io));
  const parts = [...texts, ...imported.map((i) => `Contents of ${label(root, i.path)} (imported):\n\n${i.text}`)];
  return { append: parts.join('\n\n'), excludes: [...found, ...duplicates].map((f) => f.path) };
}

function filesIn(dirs: string[], io: Reader): Found[] {
  return dirs
    .flatMap((dir) => FILES.map((name) => join(dir, name)))
    .map((path) => ({ path, text: io.read(path) }))
    .filter((f): f is Found => f.text !== undefined && f.text !== '');
}

/** `@path` tokens as Claude Code reads them: at line start or after whitespace, never inside code. */
export function importsOf(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/(?:^|\s)@(\S+)/g)].map((m) => m[1] as string);
}

/** Depth-first, each file once. A token that names no file (`@someone`) is ignored, as Claude Code does. */
function expand(file: Found, depth: number, seen: Set<string>, io: Reader): Found[] {
  if (depth > MAX_DEPTH) return [];
  return importsOf(file.text).flatMap((token) => {
    const path = target(token, dirname(file.path), io.home);
    const text = seen.has(path) ? undefined : io.read(path);
    if (!text) return [];
    seen.add(path);
    const next = { path, text };
    return [next, ...expand(next, depth + 1, seen, io)];
  });
}

function target(token: string, dir: string, home: string): string {
  return token.startsWith('~/') ? join(home, token.slice(2)) : resolve(dir, token);
}

/** Repo-relative when inside the repo, so every worktree produces the same text (the cache key). */
function label(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}
