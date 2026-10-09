# claude-warm

Start [Claude Code](https://docs.claude.com/en/docs/claude-code) with your repo's `CLAUDE.md` in the **cached** system prompt, so every new session, and every sibling git worktree, reuses the prompt cache instead of paying to rewrite it.

```
cw                 # claude in this folder
cw my-repo -c      # claude in ./my-repo (or under CW_ROOTS), continuing the last session
```

Same Claude, same instructions, same flags. Only the order of what is sent changes.

## Why

Claude Code sends your `CLAUDE.md` inside the **first user message**, and puts your working directory and git status in the **system prompt**. Both change from one session to the next, so the model provider's prompt cache never matches. In a repo with a big `CLAUDE.md` (50k+ tokens), every new session rewrites all of it, at the cache-write price.

If you use git worktrees, one per task or per agent, you pay that again for every worktree, even though the instructions are identical.

## What you get

Measured with `scripts/measure.sh` on two directories with the same 450 KB `CLAUDE.md` (a synthetic file, so you can reproduce it), `claude -p`, haiku, Claude Code 2.1.284. Numbers are for the **second** directory:

| Run | Tokens written to cache | Tokens read from cache | Cost |
|---|---|---|---|
| plain `claude` | 92,155 | 13,696 | $0.186 |
| `cw` | 5,583 | 100,178 | $0.022 |

About 8x cheaper for the second session. On a real 137 KB `CLAUDE.md` (two sibling worktrees of a production repo) the same test went from 52k tokens written to 6k.

One sample per row, print mode. Your numbers depend on file size and model. Run the script on your own repo before you trust ours.

## Install

```
npm install -g claude-warm
```

Needs Node 18+ and `claude` on your PATH. Or try it without installing: `npx claude-warm -c`.

From source: `git clone https://github.com/YoanPtr/claude-warm && cd claude-warm && npm install && npm run build && npm link`.

Prefer the short name `cc`? `alias cc=cw` in your shell profile. (We don't ship `cc` ourselves: it is the C compiler on most machines.)

## Use

| You type | What happens |
|---|---|
| `cw` | `claude` in the current folder, with the CLAUDE.md treatment |
| `cw my-repo` | `claude` in `./my-repo`, or in `my-repo` under one of your `CW_ROOTS` |
| `cw -c`, `cw -p "hi" --model haiku` | anything starting with `-` goes straight to `claude`, folder unchanged |
| `cw my-repo "fix the login bug"` | first word is a repo only if it names a folder; the rest goes to `claude` |

See exactly what it will run, without starting anything: `CW_DRY_RUN=1 cw my-repo -c`.

## How it works

1. Picks the working folder (the repo you named, or where you are).
2. Reads `CLAUDE.md` and `AGENTS.md` there. Neither exists or both are empty: it runs plain `claude`.
3. Saves the text to `~/.claude-warm/<hash>.md`, named by a hash of the content. Same text in two repos gives the same file.
4. Runs `claude` with three flags:

| Flag | Why it is needed |
|---|---|
| `--append-system-prompt-file <that file>` | the instructions ride in the system prompt, which is identical across sessions, so it is cached |
| `--settings '{"claudeMdExcludes":[exact paths]}'` | Claude Code must not load the same files again in the first message (that would send them twice) |
| `--exclude-dynamic-system-prompt-sections` | working folder and git status leave the system prompt and go in the first message. **Without this, every worktree has a different prefix and nothing is reused**: we measured no gain at all without it |

5. Forwards your exit code. It ignores Ctrl-C itself, so `claude` handles it.

If `AGENTS.md` is a symlink to `CLAUDE.md`, the text is appended once and both paths are excluded.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `CW_ROOTS` | none | folders searched for `cw <repo>`, separated by `:` (`;` on Windows) |
| `CW_ENV` | none | extra `NAME=value` pairs for the claude process only, separated by spaces |
| `CW_HOME` | `~/.claude-warm` | where the instruction text files go (mode 600) |
| `CW_CLAUDE` | `claude` | binary to run |
| `CW_DRY_RUN` | off | print the plan as JSON and exit |

## Limits

- The `CLAUDE.md` text is read **once, at session start**. Edit it, then start a new session.
- The prompt cache lasts about 5 minutes. The first session after a pause still writes; the gain is across sessions started close together (agents, worktrees, repeated runs).
- Two different `CLAUDE.md` files have two different caches. The gain needs identical text, which is the case for worktrees of one repo.
- Resuming a session that was started with plain `claude` carries `CLAUDE.md` twice (the old first message plus the append).
- Relies on these Claude Code flags: `--append-system-prompt-file`, `--exclude-dynamic-system-prompt-sections`, `--settings` with `claudeMdExcludes`. Tested on 2.1.284. If a future version changes them, `CW_DRY_RUN=1` shows what we pass; please open an issue.
- Tested on macOS. Linux should work (CI runs there). Windows is untested.
- It reads files from the folder you point it at and writes only to `CW_HOME`. It sends nothing anywhere itself.

## Check it on your repo

```
git worktree add ../my-repo-b
./scripts/measure.sh ./my-repo ./my-repo-b
```

Costs a few cents. Compare the **cw, second dir** line against **plain claude, second dir**.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `cw: command not found` | `npm install -g claude-warm`, or fix your npm global bin PATH |
| `cw: cannot start claude` | `claude` not on PATH; set `CW_CLAUDE=/path/to/claude` |
| no saving on the second worktree | the two `CLAUDE.md` differ, or more than 5 minutes passed, or the first run was not under `cw` |
| the file seems ignored | check with `CW_DRY_RUN=1`; the exclude paths must match the folder you run in |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm run check` runs types and tests. A change to the three flags needs a fresh `scripts/measure.sh` result in the PR.

## Licence

MIT.
