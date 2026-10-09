import type { Session } from './claude.js';
import { compare, tokens, type Change, type Part } from './parts.js';
import type { Outcome } from './scenarios.js';

type Row = Part & { change: Change };

const LABEL: Record<Change, string> = { same: 'same', path: 'path changed', changed: '**changed**', new: 'new' };
const n = (x: number) => x.toLocaleString('en-US');

function rows(s: Session, warm: Session): Row[] {
  return compare(s.parts, warm.parts);
}

/** System prompt first (its order), then the first message, biggest part first. */
function order(names: Map<string, Row>): Row[] {
  const all = [...names.values()];
  return [...all.filter((r) => r.where === 'system'), ...all.filter((r) => r.where === 'message').sort((a, b) => b.chars - a.chars)];
}

function cell(r: Row | undefined): string {
  return r ? `${n(tokens(r.chars))} | ${LABEL[r.change]}` : '- | -';
}

/** What a runner's measured session reuses and what it rewrites, in two sentences. */
export function verdict(runner: string, r: Row[], s: Session): string {
  const sys = r.filter((x) => x.where === 'system');
  const msg = r.filter((x) => x.where === 'message');
  const broken = sys.find((x) => x.change !== 'same');
  const sum = (xs: Row[]) => n(tokens(xs.reduce((t, x) => t + x.chars, 0)));
  const breakers = msg.filter((x) => x.change !== 'same').map((x) => x.name);
  const head = broken
    ? `System prompt (≈${sum(sys)}) differs at "${broken.name}", so almost the whole request is rewritten.`
    : `System prompt (≈${sum(sys)}) is identical, so it is read from the cache.`;
  const tail = breakers.length ? `In the first message (≈${sum(msg)}), these differ and break the cache: ${breakers.join(', ')}.` : `The first message (≈${sum(msg)}) is identical.`;
  return `- **${runner}**: ${head} ${tail} Real: ${n(s.written)} written, ${n(s.read)} read.`;
}

/**
 * Parts still rewritten under `cw` that need not be: identical in every folder, or different only by the folder path
 * (a relative label would make them identical). Moving them into the system prompt would get them read from the cache.
 */
export function candidates(r: Row[]): Row[] {
  return r.filter((x) => x.where === 'message' && (x.change === 'same' || x.change === 'path') && x.name !== 'your prompt').sort((a, b) => b.chars - a.chars).slice(0, 5);
}

export function cacheMap(o: Outcome): string[] {
  const plain = rows(o.plain, o.warm.plain);
  const cw = rows(o.cw, o.warm.cw);
  if (plain.length === 0 && cw.length === 0) return [];
  const byName = (rs: Row[]) => new Map(rs.map((r) => [r.name, r]));
  const [p, c] = [byName(plain), byName(cw)];
  const names = order(new Map([...p, ...c]));
  const table = names.map((r) => `| ${r.name} | ${r.where} | ${cell(p.get(r.name))} | ${cell(c.get(r.name))} |`);
  const why = (r: Row) => (r.change === 'path' ? 'only its folder path differs' : 'identical in every folder');
  const fix = candidates(cw).map((r, i) => `${i + 1}. ${r.name}: ≈${n(tokens(r.chars))} tokens, ${why(r)}, rewritten with the first message`);
  return [
    '',
    `## Cache map: ${o.scenario.name}`,
    '',
    'Each part of the first request, measured session vs the warm-up session. The API reuses the longest identical start of the request, so a part that differs breaks the cache for everything after it. Tokens ≈ characters / 4.',
    '',
    verdict('plain', plain, o.plain),
    verdict('cw', cw, o.cw),
    '',
    '| Part | where | plain ≈tokens | plain | cw ≈tokens | cw |',
    '|---|---|---:|---|---:|---|',
    ...table,
    ...(fix.length ? ['', 'Biggest parts `cw` still rewrites but could cache:', '', ...fix] : []),
  ];
}
