# Contributing

1. `npm install`
2. `npm run check` (types, unit tests, and an end-to-end suite: the packed tarball is installed in a clean folder and run against a fake `claude`, including real git worktrees) must pass.
   Real Claude, real API, real git repo and worktrees, a few cents to a dollar: `npm run e2e:real` (needs `claude` logged in). It checks the cache saving, that CLAUDE.md is not loaded twice, that instructions are followed, that branch and dirty files are still known, and that edits apply to the next session.
3. Behaviour change in `plan.ts`: add a test in `test/plan.test.ts`.
4. A change to the three flags needs a fresh measurement: `scripts/measure.sh <dirA> <dirB>`, paste the numbers in the PR.

Issues that help most: your Claude Code version, OS, and the output of `CW_DRY_RUN=1 cw ...`.
