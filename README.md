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
