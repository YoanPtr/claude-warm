# claude-warm

[![npm](https://img.shields.io/npm/v/claude-warm)](https://www.npmjs.com/package/claude-warm) [![ci](https://github.com/YoanPtr/claude-warm/actions/workflows/ci.yml/badge.svg)](https://github.com/YoanPtr/claude-warm/actions/workflows/ci.yml)

Start [Claude Code](https://docs.claude.com/en/docs/claude-code) with your repo's `CLAUDE.md` in the **cached** system prompt. Every new session and every git worktree of the repo then reuses the prompt cache instead of paying to write it again.

```
cw                 # claude in this folder
cw my-repo -c      # claude in ./my-repo (or under CW_ROOTS), continuing the last session
```

You get the same Claude, the same instructions and the same flags. Only the order of what is sent changes.

## Why

Claude Code sends your `CLAUDE.md` in the **first user message**, and puts your working directory and git status in the **system prompt**. Both change between sessions, so the prompt cache never matches. In a repo with a big `CLAUDE.md` (50k+ tokens), every new session writes all of it again at the cache-write price.

With git worktrees (one per task or per agent), you pay that again for every worktree, even though the instructions are identical.

This is a known, open problem in Claude Code: see [Known issues this works around](#known-issues-this-works-around).

## What you get

Measured by the real-Claude test suite (`npm run e2e:real`): a real git repo with a 67k-token `CLAUDE.md`, haiku, Claude Code 2.1.284. Each row is a session started after a first session elsewhere in the repo:

| Session | plain `claude` writes | `cw` writes |
|---|---|---|
| sibling worktree (`../repo-b`) | 67,431 | 5,922 |
| worktree with uncommitted changes, other branch | 67,431 | 5,925 |
| worktree nested in the repo (`.claude/worktrees/x`) | 67,431 | 5,924 |
| worktree in another tree (`~/worktrees/repo/task`) | 67,431 | 5,920 |
| subfolder of a worktree | 67,431 | 5,922 |
| **interactive REPL**, worktree in another tree | 67,555 | 5,947 |

About 11x fewer tokens written for every session after the first. On a production repo with a 137 KB `CLAUDE.md`, two sibling worktrees went from 52k tokens written to 6k.

Your numbers depend on file size and model. Run [the script](#check-it-on-your-repo) on your own repo before you trust ours.

## Install

```
npm install -g claude-warm
```

It needs Node 18+ and `claude` on your PATH. To try it without installing, run `npx claude-warm -c`.

From source: `git clone https://github.com/YoanPtr/claude-warm && cd claude-warm && npm install && npm run build && npm link`.

If you prefer the short name `cc`, add `alias cc=cw` to your shell profile. We don't ship `cc` ourselves, because it is the C compiler on most machines.

## Use

| You type | What happens |
|---|---|
| `cw` | `claude` in the current folder, with the treatment |
| `cw my-repo` | `claude` in `./my-repo`, in `my-repo` under one of your `CW_ROOTS`, or at an absolute path |
| `cw -c`, `cw -p "hi" --model haiku` | anything starting with `-` goes straight to `claude`, and the folder is unchanged |
| `cw my-repo "fix the login bug"` | the first word is a repo only if it names a folder; the rest goes to `claude` |
| `cw mcp list` | subcommands pass through unchanged |

To see exactly what it will run without starting anything, run `CW_DRY_RUN=1 cw my-repo -c`.

## How it works

1. It picks the working folder: the repo you named, or the folder you are in.
2. It walks up to the git root. That is the folder holding `.git`, which is a folder in the main repo and a file in a worktree. From any subfolder, it uses the root's files.
3. It reads `CLAUDE.md`, `.claude/CLAUDE.md` and `AGENTS.md` from the root down to your folder, and inlines their `@path` imports. If it finds none, it runs plain `claude`.
4. It saves the text to `~/.claude-warm/<hash>.md`, named by a hash of the content. Every worktree with the same text gets the same file, wherever it lives.
5. It runs `claude` with three flags:

| Flag | Why it is needed |
|---|---|
| `--append-system-prompt-file <that file>` | the instructions go in the system prompt, which is identical across sessions, so it is cached |
| `--settings '{"claudeMdExcludes":[exact paths]}'` | Claude Code must not load the same files again in the first message, which would send them twice |
| `--exclude-dynamic-system-prompt-sections` | the working folder and git status leave the system prompt and go in the first message. **Without this, every worktree has a different prefix and nothing is reused.** We measured no gain at all without it |

6. It forwards your exit code. It ignores Ctrl-C, which `claude` handles, and passes `SIGTERM` and `SIGHUP` on to `claude`.

Details that keep behaviour identical to plain `claude`:
- If `AGENTS.md` is a symlink to `CLAUDE.md`, the text is appended once and both paths are excluded.
- `@imports` are inlined. Excluded files' imports are no longer followed by Claude Code, so without this they would be lost. Imports work as in Claude Code: relative to the importing file, `~/` for home, never inside code, at most 5 hops deep.
- A worktree nested inside its main repo also excludes the main repo's identical `CLAUDE.md`, which Claude Code would otherwise load a second time from the parent folder. Parent-folder files with different text keep loading normally.
- `CLAUDE.md` files in deeper subfolders, `CLAUDE.local.md` and your user `~/.claude/CLAUDE.md` are not touched. Claude Code loads them as usual.

## Known issues this works around

| Claude Code issue | What `cw` does |
|---|---|
| [#93499](https://github.com/anthropics/claude-code/issues/93499) (open): `CLAUDE.md` is written to the cache again at every session start | moves it into the cached system prompt. The issue's workaround drops nested `CLAUDE.md` files and `@imports`; `cw` keeps both |
| [#48236](https://github.com/anthropics/claude-code/issues/48236) (closed, not planned): `Primary working directory:` makes the system prompt uncacheable across worktrees | passes `--exclude-dynamic-system-prompt-sections`, measured on every worktree layout above |
| [#87282](https://github.com/anthropics/claude-code/issues/87282) (closed, not planned): that flag has no settings or env equivalent | `cw` passes it for you on every start. The issue says the interactive REPL ignores the flag; on 2.1.284 we measured the REPL gets the full saving (table above) |

Using the Agent SDK instead of the CLI? The same recipe is `systemPrompt: { type: 'preset', preset: 'claude_code', append }`, `settings: { claudeMdExcludes }` and `excludeDynamicSections: true`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `CW_ROOTS` | none | folders searched for `cw <repo>`, separated by `:` (`;` on Windows) |
| `CW_ENV` | none | extra `NAME=value` pairs for the claude process only, separated by spaces |
| `CW_HOME` | `~/.claude-warm` | where the instruction text files go (mode 600). Safe to delete at any time |
| `CW_CLAUDE` | `claude` | binary to run |
| `CW_DRY_RUN` | off | print the plan as JSON and exit |

## Limits

- The `CLAUDE.md` text is read **once, at session start**. If you edit it, including through `/memory`, start a new session to apply the change.
- The prompt cache lasts about 5 minutes. The first session after a pause still writes. The gain is across sessions started close together: agents, worktrees and repeated runs.
- The gain needs identical text. Two different `CLAUDE.md` files have two different caches.
- Resuming a session that was started with plain `claude` carries `CLAUDE.md` twice: once in the old first message and once in the append.
- It relies on these Claude Code flags: `--append-system-prompt-file`, `--exclude-dynamic-system-prompt-sections`, and `--settings` with `claudeMdExcludes`. It was tested on 2.1.284. If a future version changes them, `CW_DRY_RUN=1` shows what we pass; please open an issue.
- Tested on macOS and Linux (CI). Windows is untested.
- `CW_HOME` gains one small file per distinct `CLAUDE.md` text. Delete it whenever you like.
- It reads files from the repo you point it at and writes only to `CW_HOME`. It sends nothing anywhere itself.

## Check it on your repo

```
git worktree add ../my-repo-b
./scripts/measure.sh ./my-repo ../my-repo-b
```

It costs a few cents. Compare the **cw, second dir** line against **plain claude, second dir**.

## Benchmark: a real repo, not just CLAUDE.md

```
npm run bench                         # built-in realistic repo, about $1 on haiku
npm run bench -- --repo ~/code/my-app # your repo, plus a temporary worktree of it (removed afterwards)
npm run bench -- --only "work session" --model sonnet
```

Real Claude Code and real API usage. It uses your own `~/.claude` (login, plugins, skills, MCP), so the numbers are yours. Each scenario runs one session that warms the cache, then the measured session: once with plain `claude`, once with `cw`. Results go to `bench-results/<time>.md` and `.json`.

The built-in repo has what busy repos have: a `CLAUDE.md` with an `@import`, an always-on and a path-scoped `.claude/rules` file, a nested `src/api/CLAUDE.md`, a `CLAUDE.local.md` per worktree, a SessionStart hook, an MCP server, 8 skills, 6 subagents and 4 commands. Each feature hides a secret word; the bench fails if a word plain `claude` finds is missed under `cw`. It also fails if Claude Code loads a different list of tools, MCP servers, skills, agents, commands or plugins under `cw`.

Results on Claude Code 2.1.284, haiku, the built-in repo (2026-10-09):

| Measured session | plain written | cw written | plain cost | cw cost | saved |
|---|---:|---:|---:|---:|---:|
| new session, same folder, after an edit | 18,548 | 9,015 | $0.039 | $0.021 | 46% |
| sibling worktree | 18,764 | 9,214 | $0.040 | $0.021 | 46% |
| dirty worktree, other branch | 18,767 | 9,217 | $0.040 | $0.021 | 46% |
| nested worktree (`.claude/worktrees`) | 18,867 | 9,307 | $0.040 | $0.022 | 46% |
| worktree in another folder | 18,769 | 9,217 | $0.040 | $0.021 | 46% |
| subfolder of a worktree | 18,659 | 9,190 | $0.039 | $0.022 | 45% |
| always-on features (no tools) | 18,793 | 9,243 | $0.041 | $0.022 | 45% |
| work session: skill, subagent, MCP, nested files | 21,623 | 12,240 | $0.084 | $0.048 | 43% |

All 10 features worked under `cw`, and Claude Code loaded the same tools, skills, agents, commands, MCP servers and plugins. About 9k tokens are still written under `cw`: `.claude/rules`, `CLAUDE.local.md`, the hook output and the skill list stay in the first message, which differs per worktree. Moving the always-on rules into the cached prompt is the next step.

### Cache map: what is reused, what is rewritten

The report also prints a cache map for the sibling-worktree and work-session scenarios (`--repo`: the fresh worktree). It reads each session's first request part by part from the transcript (system prompt blocks, `CLAUDE.md`, each rule file, skill list, agent list, hook output, git status...). Then it compares every part with the warm-up session: same, path changed, or changed. The API reuses the longest identical start of a request, so the first part that changes is where the cache breaks. It ends with the biggest parts `cw` still rewrites but could cache. On the built-in repo:

| Part | plain | cw |
|---|---|---|
| `CLAUDE.md` (≈8.3k tokens) | first message, path changed: rewritten | system prompt, same: **read from cache** |
| `.claude/rules/style.md` (≈2.6k) | path changed: rewritten | path changed: rewritten |
| skill list (≈2.3k), agent list (≈0.6k) | same, but after a change: rewritten | same, but after a change: rewritten |
| git status, environment | changed | changed |

Plain `claude` rewrites `CLAUDE.md` in a new worktree only because its folder path is part of the text. Every part's sizes and hashes are in the JSON for every scenario.

On real repos: one with a ~9k-token `CLAUDE.md`, 11 skills and 3 MCP servers wrote 8,700 tokens instead of 19,086 in a fresh worktree (49%), and 0 instead of 18,853 in a new session in the same folder. A repo with a ~1k-token `CLAUDE.md` gains less: 6,027 instead of 6,556 (11%).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `cw: command not found` | run `npm install -g claude-warm`, or fix your npm global bin PATH |
| `cw: cannot start claude` | `claude` isn't on your PATH; set `CW_CLAUDE=/path/to/claude` |
| no saving on the second worktree | the two `CLAUDE.md` files differ, more than 5 minutes passed, or the first run was not under `cw` |
| the file seems ignored | check with `CW_DRY_RUN=1`; the exclude paths must match the repo you run in |

## Tests

- `npm run check` runs on every push (macOS and Linux, Node 18, 20 and 22). It runs the types, unit tests and an end-to-end suite. The suite installs the packed tarball in a clean folder and runs it in a real git repo with worktrees in every layout, against a fake `claude` that records how it was started.
- `npm run e2e:real` (opt-in, about $0.80 on haiku) uses your real Claude Code against the real API. It checks the saving on every worktree layout in print mode and in the interactive REPL. It also checks that `CLAUDE.md` is not loaded twice, that instructions and `@imports` are followed, that the branch and dirty files are still known, and that edits are picked up.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT.
