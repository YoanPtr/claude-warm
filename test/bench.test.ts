import { describe, expect, it } from 'vitest';
import { cleanEnv, parseStream, type Loaded, type Session } from '../bench/claude.js';
import { features, markdown, parity, regressions } from '../bench/report.js';
import type { Outcome, Scenario } from '../bench/scenarios.js';
import { candidates } from '../bench/map.js';
import { compare, partsOf } from '../bench/parts.js';

const init = { type: 'system', subtype: 'init', session_id: 's1', tools: ['Read', 'Skill'], mcp_servers: [{ name: 'bench', status: 'connected' }, { name: 'gh', status: 'failed' }], skills: ['b', 'a'], agents: ['x'], slash_commands: ['c'], plugins: [{ name: 'p' }], output_style: 'default' };
const stream = [
  JSON.stringify({ type: 'system', subtype: 'hook_started' }),
  JSON.stringify(init),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'release-notes' } }] } }),
  JSON.stringify({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: 'word-finder' } }, { type: 'text', text: 'hi' }] } }),
  JSON.stringify({ type: 'result', result: 'The word is KIWI-1.', total_cost_usd: 0.05, usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 900, input_tokens: 5, output_tokens: 7 } }),
].join('\n');

const loaded = (over: Partial<Loaded> = {}): Loaded => ({ tools: ['Read'], mcp: ['bench'], skills: ['a'], agents: ['x'], commands: [], plugins: [], outputStyle: 'default', ...over });
const sess = (text: string, l = loaded()): Session => ({ runner: 'plain', cwd: '/r', id: 'i', written: 1000, read: 0, input: 1, output: 1, cost: 0.1, text, calls: [], loaded: l, parts: [] });
const scenario: Scenario = { name: 's', warm: '/a', measure: '/b', prompt: 'p', tools: [], words: { skill: 'KIWI-1', rule: 'FIG-2' } };

describe('parseStream', () => {
  const s = parseStream(stream);
  it('reads usage and cost from the result event', () => {
    expect(s).toMatchObject({ id: 's1', written: 100, read: 900, input: 5, output: 7, cost: 0.05, text: 'The word is KIWI-1.' });
  });
  it('lists main-agent tool calls with the skill or subagent name, not the subagent own calls', () => {
    expect(s.calls).toEqual(['Skill:release-notes', 'Task:word-finder']);
  });
  it('reduces the init event to sorted names, flagging MCP servers that did not connect', () => {
    expect(s.loaded).toEqual({ tools: ['Read', 'Skill'], mcp: ['bench', 'gh (failed)'], skills: ['a', 'b'], agents: ['x'], commands: ['c'], plugins: ['p'], outputStyle: 'default' });
  });
  it('fails loudly without a result event', () => {
    expect(() => parseStream(JSON.stringify(init))).toThrow(/no init or result/);
  });
});

describe('report', () => {
  const o: Outcome = { scenario, plain: sess('kiwi-1 and FIG-2'), cw: { ...sess('KIWI-1'), runner: 'cw', written: 200, cost: 0.04 }, warm: { plain: sess(''), cw: sess('') } };
  it('matches words case-insensitively, per runner', () => {
    expect(features(o)).toEqual([['skill', 'KIWI-1', true, true], ['rule', 'FIG-2', true, false]]);
  });
  it('names what only one runner loaded', () => {
    expect(parity(loaded(), loaded({ skills: ['a', 'z'], outputStyle: 'x' }))).toEqual(['skills only under cw: z', 'outputStyle: plain "default", cw "x"']);
    expect(parity(loaded(), loaded())).toEqual([]);
  });
  it('flags a feature cw lost, not one plain also missed', () => {
    expect(regressions([o])).toEqual(['cw lost: rule']);
  });
  it('prints the totals and the saving', () => {
    const md = markdown('T', ['m'], [o]);
    expect(md).toContain('| **Total** | **1,000** | **200** |');
    expect(md).toContain('**60%**');
    expect(md).toContain('| rule | `FIG-2` | yes | NO |');
  });
});

it('cleanEnv drops the parent Claude Code session variables only', () => {
  expect(cleanEnv({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', PATH: '/bin', CLAUDE_CONFIG_DIR: '/c' })).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/c' });
});

describe('cache map', () => {
  const lines = (cwd: string, status: string) => [
    { type: 'attachment', attachment: { type: 'hook_success', hookName: 'SessionStart:startup', content: 'team word' } },
    { type: 'user', message: { content: 'reply with: ok' } },
    { type: 'attachment', attachment: { type: 'instructions', files: [{ path: `${cwd}/CLAUDE.md`, content: 'rules' }, { path: `${cwd}/.claude/rules/a.md`, content: 'rule a' }] } },
    { type: 'attachment', attachment: { type: 'session_context', context: { gitStatus: status } } },
    { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: ['# System\nbase', '# Project rules\nrules'] } },
    { type: 'assistant', message: {} },
    { type: 'attachment', attachment: { type: 'date', date: 'later, not part of the first request' } },
  ];
  const warm = partsOf(lines('/r/main', 'clean'), '/r/main');
  const measured = partsOf(lines('/r/wt', 'dirty'), '/r/wt');

  it('splits the first request into system blocks first, then the first message, stopping at the first answer', () => {
    expect(measured.map((p) => `${p.where} ${p.name}`)).toEqual([
      'system system: # System',
      'system system: # Project rules',
      'message hook output: SessionStart:startup',
      'message your prompt',
      'message instructions: CLAUDE.md',
      'message instructions: .claude/rules/a.md',
      'message context: gitStatus',
    ]);
  });
  it('tells a path-only change from a real one', () => {
    const changes = Object.fromEntries(compare(measured, warm).map((p) => [p.name, p.change]));
    expect(changes).toMatchObject({ 'system: # System': 'same', 'instructions: CLAUDE.md': 'path', 'context: gitStatus': 'changed', 'hook output: SessionStart:startup': 'same' });
  });
  it('ranks parts cw could still cache: identical or path-only, biggest first, never the prompt or a changing part', () => {
    expect(candidates(compare(measured, warm)).map((p) => p.name)).toEqual(['instructions: .claude/rules/a.md', 'instructions: CLAUDE.md', 'hook output: SessionStart:startup']);
  });
  it('numbers repeated parts so each keeps its own row', () => {
    const twice = partsOf([lines('/r', 's')[0]!, lines('/r', 's')[0]!], '/r');
    expect(twice.map((p) => p.name)).toEqual(['hook output: SessionStart:startup', 'hook output: SessionStart:startup #2']);
  });
});
