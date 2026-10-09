import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { transcriptDir, type Options } from './claude.js';
import { makeFixture } from './fixture.js';
import { markdown, regressions } from './report.js';
import { fixtureScenarios, repoScenarios, runScenario, type Outcome, type Scenario } from './scenarios.js';

const HELP = `npm run bench -- [--repo <path>] [--model haiku] [--only <text>] [--budget 1] [--out bench-results]

Real Claude Code, real API usage: each scenario runs a session that warms the cache, then the measured
session, once with plain \`claude\` and once with \`cw\`. Uses your own ~/.claude config and login.
Without --repo: a built-in repo with CLAUDE.md, @imports, rules, a hook, CLAUDE.local.md, skills,
subagents, commands and an MCP server, in every worktree layout (about $1-2 on haiku).
With --repo: your repo, then a temporary worktree of it (removed afterwards).`;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function args() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      model: { type: 'string', default: 'haiku' },
      only: { type: 'string' },
      budget: { type: 'string', default: '1' },
      out: { type: 'string', default: join(root, 'bench-results') },
      help: { type: 'boolean', short: 'h' },
    },
  });
  return values;
}

interface Setup {
  title: string;
  scenarios: Scenario[];
  cleanup: () => void;
}

function fixtureSetup(): Setup {
  const f = makeFixture();
  const cleanup = () => {
    rmSync(f.base, { recursive: true, force: true });
    const prefix = basename(transcriptDir(f.base));
    const projects = join(homedir(), '.claude/projects');
    if (existsSync(projects)) for (const d of readdirSync(projects)) if (d.startsWith(prefix)) rmSync(join(projects, d), { recursive: true, force: true });
  };
  return { title: 'claude-warm bench: built-in realistic repo', scenarios: fixtureScenarios(f), cleanup };
}

function repoSetup(path: string): Setup {
  const repo = realpathSync(path);
  const top = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'cw-bench-'))), basename(top));
  execFileSync('git', ['-C', top, 'worktree', 'add', '-q', '--detach', wt]);
  const cleanup = () => {
    execFileSync('git', ['-C', top, 'worktree', 'remove', '--force', wt]);
    rmSync(dirname(wt), { recursive: true, force: true });
    rmSync(transcriptDir(wt), { recursive: true, force: true });
  };
  return { title: `claude-warm bench: ${basename(top)}`, scenarios: repoScenarios(top, wt), cleanup };
}

async function main(): Promise<void> {
  const a = args();
  if (a.help) return console.log(HELP);
  const o: Options = { cw: join(root, 'dist/main.js'), model: a.model as string, budget: Number(a.budget), tools: [] };
  const setup = a.repo ? repoSetup(a.repo) : fixtureSetup();
  const outcomes: Outcome[] = [];
  try {
    for (const s of setup.scenarios.filter((s) => !a.only || s.name.includes(a.only))) outcomes.push(await runScenario(s, o, (l) => console.error(l)));
  } finally {
    setup.cleanup();
  }
  const version = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
  const spent = outcomes.reduce((t, x) => t + x.plain.cost + x.cw.cost + x.warm.plain.cost + x.warm.cw.cost, 0);
  const meta = [`Claude Code ${version}, model ${o.model}, ${new Date().toISOString()}`, 'written / read: prompt-cache tokens of the measured session, from the API usage Claude Code reports', `This run spent $${spent.toFixed(2)} in total (warm-up sessions included; all in the .json)`];
  const md = markdown(setup.title, meta, outcomes);
  mkdirSync(a.out as string, { recursive: true });
  const stem = join(a.out as string, new Date().toISOString().replace(/[:.]/g, '-'));
  writeFileSync(`${stem}.md`, md);
  writeFileSync(`${stem}.json`, JSON.stringify({ meta, outcomes }, null, 2));
  console.log(md);
  console.error(`Saved ${stem}.md and .json`);
  const bad = regressions(outcomes);
  if (bad.length) {
    console.error(`Regressions:\n${bad.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exitCode = 1;
});
