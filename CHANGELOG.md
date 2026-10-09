# Changelog

## 0.2.0

- Every worktree layout shares one cache: sibling, nested in the repo (`.claude/worktrees/x`), in another tree (`~/worktrees/repo/task`), and any subfolder of one. `cw` now walks up to the git root.
- `@imports` in `CLAUDE.md` are inlined. Before, they were lost, because Claude Code no longer follows the imports of an excluded file.
- `.claude/CLAUDE.md` is read too.
- A worktree nested in its main repo also excludes the main repo's identical `CLAUDE.md`, so it isn't loaded twice.
- `cw /absolute/path` and `cw ../repo` work.
- `SIGTERM` and `SIGHUP` sent to `cw` are passed on to `claude`. Exit code 128+n when `claude` dies from a signal.
- The instruction file is written atomically.
- Tests: worktrees in every layout in CI. The real-Claude suite measures the interactive REPL too, and checks `@imports`.
- README: the Claude Code issues this works around.

## 0.1.1

- Tests: end-to-end suite (packed tarball installed in a clean folder, run against a fake `claude`) and an opt-in real-Claude cache test (`npm run e2e:real`). README and CONTRIBUTING describe them. No change to the CLI.

## 0.1.0

- First release: `cw [repo] [claude args]`; `CW_ROOTS`, `CW_ENV`, `CW_HOME`, `CW_CLAUDE`, `CW_DRY_RUN`.
- Tested with Claude Code 2.1.284 on macOS (Node 22). Linux should work; Windows is untested.
