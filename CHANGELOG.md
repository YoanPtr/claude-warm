# Changelog

## Unreleased

- Tests: real git worktrees in the e2e suite; the real-Claude suite now has 5 checks (cache saving, no double load, instructions followed, branch and dirty files known, edits picked up). Docs: subfolder limitation.

## 0.1.1

- Tests: end-to-end suite (packed tarball installed in a clean folder, run against a fake `claude`) and an opt-in real-Claude cache test (`npm run e2e:real`). README and CONTRIBUTING describe them. No change to the CLI.

## 0.1.0

- First release: `cw [repo] [claude args]`; `CW_ROOTS`, `CW_ENV`, `CW_HOME`, `CW_CLAUDE`, `CW_DRY_RUN`.
- Tested with Claude Code 2.1.284 on macOS (Node 22). Linux should work; Windows is untested.
