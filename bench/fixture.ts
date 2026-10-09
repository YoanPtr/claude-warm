import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, makeRepos, type Repos } from '../test/e2e/git.js';

/**
 * One secret word per repo feature. A session that reports a word proves Claude Code loaded that feature.
 * `static` words must be known without any tool; `work` words need a tool call (skill, subagent, MCP, reading a file).
 */
export const WORDS = {
  static: {
    'CLAUDE.md': 'PINEAPPLE-4217',
    '@import': 'KIWI-5521',
    'always-on rule': 'BIRCH-3390',
    'SessionStart hook': 'COBALT-6604',
    'CLAUDE.local.md': 'AMBER-1182',
  },
  work: {
    skill: 'LANTERN-2048',
    subagent: 'HARBOR-7713',
    'MCP tool': 'CEDAR-0077',
    'nested CLAUDE.md': 'QUARTZ-5150',
    'path-scoped rule': 'MAPLE-8826',
  },
} as const;

const here = dirname(fileURLToPath(import.meta.url));
/** The compiled bench runs from `.bench/bench`; the assets stay in the source tree. */
const mcpServer = resolve(here, '../../bench/assets/mcp-server.mjs');

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

/** Sizes picked to look like a busy real repo: ~8k tokens of CLAUDE.md, ~3k of rules, 8 skills, 6 agents, 4 commands. */
function files(): Record<string, string> {
  const w = WORDS;
  const f: Record<string, string> = {
    'CLAUDE.md': `# Project rules\nThe project codeword is ${w.static['CLAUDE.md']}.\nDeploy notes: @docs/deploy.md\n\n## Conventions\n${lines(400, (i) => `- Rule ${i}: keep modules small, name things for what they do, review item ${i * 7919}.`)}`,
    'docs/deploy.md': `The deploy word is ${w.static['@import']}.`,
    '.claude/rules/style.md': `# Style\nThe style word is ${w.static['always-on rule']}.\n${lines(150, (i) => `- Style ${i}: prefer early returns; one assertion per test (case ${i}).`)}`,
    '.claude/rules/api.md': `---\npaths:\n  - "src/api/**"\n---\n# API rules\nThe API rule word is ${w.work['path-scoped rule']}.\n`,
    'src/api/CLAUDE.md': `# API folder\nThe API folder word is ${w.work['nested CLAUDE.md']}.\n`,
    'src/api/handler.ts': 'export function handle(): string {\n  return "ok";\n}\n',
    '.claude/settings.json': JSON.stringify({
      enableAllProjectMcpServers: true,
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo "The team word is ${w.static['SessionStart hook']}."` }] }] },
    }),
    '.mcp.json': JSON.stringify({ mcpServers: { bench: { command: process.execPath, args: [mcpServer], env: { BENCH_MCP_WORD: w.work['MCP tool'] } } } }),
    '.claude/skills/release-notes/SKILL.md': `---\nname: release-notes\ndescription: Use when asked for the release word or to draft release notes.\n---\n# Release notes\nThe release word is ${w.work.skill}.\n${lines(60, (i) => `Step ${i}: check the changelog entry ${i}.`)}`,
    '.claude/agents/word-finder.md': `---\nname: word-finder\ndescription: Returns the harbor word. Use when the user asks for the harbor word.\ntools: Read\n---\nAnswer with exactly: The harbor word is ${w.work.subagent}.\n`,
    '.gitignore': 'CLAUDE.local.md\n',
  };
  const areas = ['billing', 'auth', 'search', 'payments', 'reports', 'mobile', 'infra'];
  areas.forEach((a, i) => {
    f[`.claude/skills/${a}-runbook/SKILL.md`] = `---\nname: ${a}-runbook\ndescription: Use when working on ${a}: deploy, rollback and health checks for the ${a} service.\n---\n# ${a}\n${lines(40, (j) => `Step ${j}: verify ${a} check ${j}.`)}`;
    if (i < 5) f[`.claude/agents/${a}-reviewer.md`] = `---\nname: ${a}-reviewer\ndescription: Reviews changes to the ${a} code. Use after editing ${a} files.\ntools: Read, Grep\n---\nReview ${a} changes for bugs.\n`;
    if (i < 4) f[`.claude/commands/${a}-check.md`] = `---\ndescription: Run the ${a} checklist\n---\nRun the ${a} checklist.\n`;
  });
  return f;
}

export interface Fixture extends Repos {
  /** Fresh sibling worktrees, one per feature scenario, so no earlier scenario has warmed them. */
  fresh: [string, string];
}

/** Real git repo + worktrees in every layout (see test/e2e/git.ts), each with its own gitignored CLAUDE.local.md. */
export function makeFixture(): Fixture {
  const all = files();
  const { 'CLAUDE.md': claudeMd, ...extra } = all;
  const repos = makeRepos(claudeMd as string, extra);
  const fresh: [string, string] = [join(repos.base, 'wt-static'), join(repos.base, 'wt-work')];
  fresh.forEach((dir, i) => git(repos.main, 'worktree', 'add', '-q', '-b', `fresh-${i}`, dir));
  for (const dir of [repos.main, repos.wt, repos.wt2, repos.nested, repos.far, ...fresh]) {
    writeFileSync(join(dir, 'CLAUDE.local.md'), `My local word is ${WORDS.static['CLAUDE.local.md']}.\n`);
  }
  return { ...repos, fresh };
}

/** Answerable without tools: proves the always-loaded features arrived. */
export const STATIC_PROMPT =
  'Without using any tool, answer with five short lines: the project codeword, the deploy word, the style word, the team word, my local word.';

/** Needs the skill, the subagent, the MCP tool and a file under src/api (which loads the nested CLAUDE.md and the path rule). */
export const WORK_PROMPT = [
  'Do these four steps, then answer with one short line per word found:',
  '1. Use the release-notes skill to find the release word.',
  '2. Ask the word-finder subagent for the harbor word.',
  '3. Call the vault_word MCP tool for the vault word.',
  '4. Read src/api/handler.ts, then tell me the API folder word and the API rule word that apply to it.',
].join('\n');

export const WORK_TOOLS = ['Skill', 'Task', 'Agent', 'Read', 'Glob', 'Grep', 'ToolSearch', 'mcp__bench__vault_word'];
