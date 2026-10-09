import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dropTranscript, session, type Options, type Runner, type Session } from './claude.js';
import { STATIC_PROMPT, WORDS, WORK_PROMPT, WORK_TOOLS, type Fixture } from './fixture.js';

export interface Scenario {
  name: string;
  /** Folder of the first session, which writes the cache. */
  warm: string;
  /** Folder of the session we measure. */
  measure: string;
  prompt: string;
  tools: string[];
  /** Feature name → word the answer must contain. */
  words: Record<string, string>;
  /** Runs between the two sessions, e.g. an edit that changes `git status`, as real work does. */
  between?: () => void;
}

export interface Outcome {
  scenario: Scenario;
  plain: Session;
  cw: Session;
  /** The sessions that warmed the cache, kept for the full log. */
  warm: { plain: Session; cw: Session };
}

const OK = 'reply with: ok';
let edits = 0;

/** Each scenario: a session in `warm`, then the measured one in `measure`. Feature scenarios get never-used worktrees. */
export function fixtureScenarios(f: Fixture): Scenario[] {
  const plainRun = (name: string, measure: string): Scenario => ({ name, warm: f.main, measure, prompt: OK, tools: [], words: {} });
  return [
    { ...plainRun('new session, same folder, after an edit', f.main), between: () => writeFileSync(join(f.main, `edit-${++edits}.txt`), 'x') },
    plainRun('sibling worktree', f.wt2),
    plainRun('dirty worktree, other branch', f.wt),
    plainRun('nested worktree (.claude/worktrees)', f.nested),
    plainRun('worktree in another folder', f.far),
    plainRun('subfolder of a worktree', join(f.far, 'src')),
    { name: 'always-on features (no tools)', warm: f.main, measure: f.fresh[0], prompt: STATIC_PROMPT, tools: [], words: { ...WORDS.static } },
    { name: 'work session: skill, subagent, MCP, nested files', warm: f.main, measure: f.fresh[1], prompt: WORK_PROMPT, tools: WORK_TOOLS, words: { ...WORDS.work } },
  ];
}

/** Your own repo: a new session in it, then one in a fresh worktree of it. */
export function repoScenarios(repo: string, worktree: string): Scenario[] {
  return [
    { name: 'new session, same folder, nothing changed', warm: repo, measure: repo, prompt: OK, tools: [], words: {} },
    { name: 'fresh worktree of the repo', warm: repo, measure: worktree, prompt: OK, tools: [], words: {} },
  ];
}

async function pair(runner: Runner, s: Scenario, o: Options): Promise<{ warm: Session; measured: Session }> {
  const opts = { ...o, tools: s.tools };
  const warm = await session(runner, s.warm, s.prompt, opts);
  s.between?.();
  const measured = await session(runner, s.measure, s.prompt, opts);
  dropTranscript(warm);
  dropTranscript(measured);
  return { warm, measured };
}

/** Plain first, then `cw`. Both find the shared start of the request (tools, built-in prompt) already cached, as in daily use. */
export async function runScenario(s: Scenario, o: Options, log: (line: string) => void): Promise<Outcome> {
  log(`- ${s.name}: plain...`);
  const plain = await pair('plain', s, o);
  log(`  written ${plain.measured.written}, $${plain.measured.cost.toFixed(3)}; cw...`);
  const cw = await pair('cw', s, o);
  log(`  written ${cw.measured.written}, $${cw.measured.cost.toFixed(3)}`);
  return { scenario: s, plain: plain.measured, cw: cw.measured, warm: { plain: plain.warm, cw: cw.warm } };
}
