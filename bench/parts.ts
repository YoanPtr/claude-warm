import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative } from 'node:path';

/** One piece of the first request, as the session transcript records it. */
export interface Part {
  name: string;
  /** `system`: the system prompt (cached first). `message`: the first message, after it. */
  where: 'system' | 'message';
  chars: number;
  /** Hash of the exact text: equal means this part can be reused from the cache. */
  hash: string;
  /** Hash with the session's folder replaced: equal while `hash` differs means only a path changed. */
  body: string;
}

export type Change = 'same' | 'path' | 'changed' | 'new';

type Entry = Record<string, any>;
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Rough token count; the tables say "≈". */
export const tokens = (chars: number) => Math.round(chars / 4);

function part(name: string, where: Part['where'], text: string, cwd: string): Part {
  return { name, where, chars: text.length, hash: sha(text), body: sha(text.split(cwd).join('<cwd>')) };
}

function label(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  if (!rel.startsWith('..')) return rel;
  return path.startsWith(homedir()) ? `~/${relative(homedir(), path)}` : path;
}

/** The first request's pieces from one attachment. Lists are split so each file or block is its own row. */
function fromAttachment(a: Entry, cwd: string): Part[] {
  const p = (name: string, text: string, where: Part['where'] = 'message') => part(name, where, text, cwd);
  switch (a.type) {
    case 'prompt_snapshot':
      return (a.systemPrompt as string[]).map((t) => p(`system: ${t.trim().split('\n')[0]?.slice(0, 50)}`, t, 'system'));
    case 'instructions':
      return (a.files as Entry[]).map((f) => p(`instructions: ${label(String(f.path), cwd)}`, `${f.path}\n${f.content}`));
    case 'session_context':
      return Object.entries(a.context ?? {}).map(([k, v]) => p(`context: ${k}`, String(v)));
    case 'hook_success':
      return [p(`hook output: ${a.hookName}`, String(a.content ?? ''))];
    default: {
      const { type, ...rest } = a;
      return [p(String(type), JSON.stringify(rest))];
    }
  }
}

/** Parts of the first request of a session: system prompt blocks, then everything sent before the first answer. */
export function partsOf(lines: Entry[], cwd: string): Part[] {
  const end = lines.findIndex((l) => l.type === 'assistant');
  const head = end === -1 ? lines : lines.slice(0, end);
  const parts = head.flatMap((l): Part[] => {
    if (l.type === 'attachment' && l.attachment) return fromAttachment(l.attachment, cwd);
    if (l.type === 'user' && !l.isMeta) return [part('your prompt', 'message', JSON.stringify(l.message?.content ?? ''), cwd)];
    return [];
  });
  const seen = new Map<string, number>();
  const named = parts.map((p) => {
    const n = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, n);
    return n === 1 ? p : { ...p, name: `${p.name} #${n}` };
  });
  return [...named.filter((p) => p.where === 'system'), ...named.filter((p) => p.where === 'message')];
}

export function readParts(transcript: string, cwd: string): Part[] {
  if (!existsSync(transcript)) return [];
  const lines = readFileSync(transcript, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Entry);
  return partsOf(lines, cwd);
}

/** How each part of the measured session compares with the same part in the warm session. */
export function compare(measured: Part[], warm: Part[]): Array<Part & { change: Change }> {
  const before = new Map(warm.map((p) => [p.name, p]));
  return measured.map((p) => {
    const w = before.get(p.name);
    const change: Change = !w ? 'new' : w.hash === p.hash ? 'same' : w.body === p.body ? 'path' : 'changed';
    return { ...p, change };
  });
}
