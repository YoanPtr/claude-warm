import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readParts, type Part } from './parts.js';

export type Runner = 'plain' | 'cw';

/** What Claude Code says it loaded (the `system/init` event), reduced to what a repo can change. */
export interface Loaded {
  tools: string[];
  mcp: string[];
  skills: string[];
  agents: string[];
  commands: string[];
  plugins: string[];
  outputStyle: string;
}

/** One real session: real API usage from Claude Code's own `result` event. */
export interface Session {
  runner: Runner;
  cwd: string;
  id: string;
  written: number;
  read: number;
  input: number;
  output: number;
  cost: number;
  text: string;
  /** Tool names called by the main agent, in order (`Skill:release-notes`, `Task:word-finder`, `mcp__bench__vault_word`). */
  calls: string[];
  loaded: Loaded;
  /** The first request piece by piece, from the transcript (filled before the transcript is deleted). */
  parts: Part[];
}

export interface Options {
  cw: string;
  model: string;
  budget: number;
  tools: string[];
}

/** Runs as a top-level terminal session, even when the bench itself runs inside Claude Code. */
export function cleanEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const drop = (k: string) => k.startsWith('CLAUDE_CODE_') || ['CLAUDECODE', 'AI_AGENT', 'CLAUDE_PID', 'CLAUDE_EFFORT'].includes(k);
  return Object.fromEntries(Object.entries(base).filter(([k]) => !drop(k)));
}

function exec(bin: string, args: string[], cwd: string): Promise<{ status: number | null; out: string; err: string }> {
  return new Promise((ok) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv(process.env) });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('close', (status) => ok({ status, out, err }));
  });
}

export async function session(runner: Runner, cwd: string, prompt: string, o: Options): Promise<Session> {
  const [bin, ...pre] = runner === 'plain' ? ['claude'] : [process.execPath, o.cw];
  const flags = ['-p', prompt, '--model', o.model, '--output-format', 'stream-json', '--verbose', '--max-budget-usd', String(o.budget)];
  const r = await exec(bin as string, [...pre, ...flags, ...(o.tools.length ? ['--allowedTools', o.tools.join(',')] : [])], cwd);
  if (r.status !== 0) throw new Error(`${runner} in ${cwd} failed (${r.status}): ${(r.err || r.out).slice(-800)}`);
  const parsed = parseStream(r.out);
  return { runner, cwd, ...parsed, parts: readParts(join(transcriptDir(cwd), `${parsed.id}.jsonl`), cwd) };
}

type Event = Record<string, any>;

/** Reads Claude Code's `stream-json` output. Pure, so it is unit tested. */
export function parseStream(out: string): Omit<Session, 'runner' | 'cwd' | 'parts'> {
  const events: Event[] = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.find((e) => e.type === 'result');
  if (!init || !result) throw new Error('stream has no init or result event');
  const u = result.usage ?? {};
  const calls = events
    .filter((e) => e.type === 'assistant' && !e.parent_tool_use_id)
    .flatMap((e) => (e.message?.content ?? []).filter((c: Event) => c.type === 'tool_use'))
    .map((c: Event) => callName(c));
  return {
    id: String(init.session_id),
    written: u.cache_creation_input_tokens ?? 0,
    read: u.cache_read_input_tokens ?? 0,
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cost: result.total_cost_usd ?? 0,
    text: String(result.result ?? ''),
    calls,
    loaded: loadedOf(init),
  };
}

function callName(c: Event): string {
  const sub = c.input?.skill ?? c.input?.subagent_type;
  return sub ? `${c.name}:${sub}` : String(c.name);
}

function loadedOf(init: Event): Loaded {
  const names = (xs: unknown): string[] => (Array.isArray(xs) ? xs.map((x) => (typeof x === 'string' ? x : `${x.name}${x.status && x.status !== 'connected' ? ` (${x.status})` : ''}`)).sort() : []);
  return {
    tools: names(init.tools),
    mcp: names(init.mcp_servers),
    skills: names(init.skills),
    agents: names(init.agents),
    commands: names(init.slash_commands),
    plugins: names(init.plugins),
    outputStyle: String(init.output_style ?? ''),
  };
}

/** Claude Code keeps one transcript folder per working folder. */
export function transcriptDir(cwd: string): string {
  return join(homedir(), '.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/** Drops the transcript of one bench session, leaving the folder's other sessions alone. */
export function dropTranscript(s: Pick<Session, 'cwd' | 'id'>): void {
  const file = join(transcriptDir(s.cwd), `${s.id}.jsonl`);
  if (existsSync(file)) rmSync(file, { force: true });
  rmSync(join(transcriptDir(s.cwd), s.id), { recursive: true, force: true });
}
