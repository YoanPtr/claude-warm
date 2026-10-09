import type { Loaded, Session } from './claude.js';
import type { Outcome } from './scenarios.js';

const n = (x: number) => x.toLocaleString('en-US');
const usd = (x: number) => `$${x.toFixed(3)}`;
const pct = (before: number, after: number) => (before > 0 ? `${Math.round((1 - after / before) * 100)}%` : '-');

/** Feature name → [plain found it, cw found it]. Case-insensitive match on the session's final answer. */
export function features(o: Outcome): Array<[string, string, boolean, boolean]> {
  const has = (s: Session, w: string) => s.text.toUpperCase().includes(w.toUpperCase());
  return Object.entries(o.scenario.words).map(([name, word]) => [name, word, has(o.plain, word), has(o.cw, word)]);
}

/** Lists that differ between plain and cw: what one loaded and the other did not. */
export function parity(a: Loaded, b: Loaded): string[] {
  const out: string[] = [];
  for (const key of Object.keys(a) as Array<keyof Loaded>) {
    const [x, y] = [a[key], b[key]];
    if (typeof x === 'string' || typeof y === 'string') {
      if (x !== y) out.push(`${key}: plain "${x}", cw "${y}"`);
      continue;
    }
    const onlyPlain = x.filter((v) => !y.includes(v));
    const onlyCw = y.filter((v) => !x.includes(v));
    if (onlyPlain.length) out.push(`${key} only under plain: ${onlyPlain.join(', ')}`);
    if (onlyCw.length) out.push(`${key} only under cw: ${onlyCw.join(', ')}`);
  }
  return out;
}

function costTable(outcomes: Outcome[]): string[] {
  const rows = outcomes.map(({ scenario, plain, cw }) =>
    `| ${scenario.name} | ${n(plain.written)} | ${n(cw.written)} | ${n(plain.read)} | ${n(cw.read)} | ${usd(plain.cost)} | ${usd(cw.cost)} | ${pct(plain.cost, cw.cost)} |`,
  );
  const sum = (f: (o: Outcome) => number) => outcomes.reduce((t, o) => t + f(o), 0);
  const [pw, cwW, pc, cc] = [sum((o) => o.plain.written), sum((o) => o.cw.written), sum((o) => o.plain.cost), sum((o) => o.cw.cost)];
  return [
    '| Measured session | plain written | cw written | plain read | cw read | plain cost | cw cost | cost saved |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    `| **Total** | **${n(pw)}** | **${n(cwW)}** | | | **${usd(pc)}** | **${usd(cc)}** | **${pct(pc, cc)}** |`,
  ];
}

function featureTable(outcomes: Outcome[]): string[] {
  const rows = outcomes.flatMap(features).map(([name, word, p, c]) => `| ${name} | \`${word}\` | ${p ? 'yes' : 'NO'} | ${c ? 'yes' : 'NO'} |`);
  if (rows.length === 0) return [];
  return ['', '## Repo features still work under cw', '', '| Feature | Word | plain | cw |', '|---|---|---|---|', ...rows];
}

function parityLines(outcomes: Outcome[]): string[] {
  const diffs = outcomes.flatMap((o) => parity(o.plain.loaded, o.cw.loaded).map((d) => `- ${o.scenario.name}: ${d}`));
  const l = outcomes[0]?.cw.loaded;
  const summary = l ? `Loaded in every session: ${l.tools.length} tools, ${l.mcp.length} MCP servers, ${l.skills.length} skills, ${l.agents.length} agents, ${l.commands.length} commands, ${l.plugins.length} plugins.` : '';
  return ['', '## Same things loaded (Claude Code init event)', '', summary, '', ...(diffs.length ? diffs : ['Identical under plain and cw in every scenario.'])];
}

export function markdown(title: string, meta: string[], outcomes: Outcome[]): string {
  return [`# ${title}`, '', ...meta.map((m) => `- ${m}`), '', '## Cache and cost of the measured session', '', ...costTable(outcomes), ...featureTable(outcomes), ...parityLines(outcomes), ''].join('\n');
}

/** Exit status: any feature plain found but cw missed, or anything loaded differently, fails the bench. */
export function regressions(outcomes: Outcome[]): string[] {
  const lost = outcomes.flatMap(features).filter(([, , p, c]) => p && !c).map(([name]) => `cw lost: ${name}`);
  const diff = outcomes.flatMap((o) => parity(o.plain.loaded, o.cw.loaded).map((d) => `${o.scenario.name}: ${d}`));
  return [...lost, ...diff];
}
