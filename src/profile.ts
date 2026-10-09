const FILES = ['CLAUDE.md', 'AGENTS.md'];

export interface Profile {
  /** Instruction text to append to the system prompt (identical files appear once). */
  append: string;
  /** Exact paths Claude Code must not load a second time (`claudeMdExcludes`). */
  excludes: string[];
}

/**
 * Reads the repo's CLAUDE.md and AGENTS.md. `read` returns the file text, or undefined when absent.
 * Nothing found: undefined (plain `claude`). AGENTS.md is often a symlink to CLAUDE.md, so identical
 * text is appended once while both paths are still excluded.
 */
export function readProfile(cwd: string, read: (path: string) => string | undefined): Profile | undefined {
  const found = FILES.map((name) => ({ path: `${cwd}/${name}`, text: read(`${cwd}/${name}`) })).filter(
    (f): f is { path: string; text: string } => f.text !== undefined && f.text !== '',
  );
  if (found.length === 0) return undefined;
  return { append: [...new Set(found.map((f) => f.text))].join('\n\n'), excludes: found.map((f) => f.path) };
}
