# Contributing

1. `npm install`
2. `npm run check` must pass. It runs types, unit tests and the end-to-end suite (packed tarball, real git worktrees in every layout, fake `claude`).
3. If you change behaviour in `src/plan.ts` or `src/profile.ts`, add a unit test in `test/plan.test.ts`. If the change is visible to users, add an e2e test in `test/e2e/e2e.test.ts` too.
4. If you change the three flags or what goes into the appended text, run `npm run e2e:real` and paste its numbers in the PR. It needs `claude` logged in and `python3`, and costs about $0.80 on haiku. `scripts/measure.sh <dirA> <dirB>` measures your own repo.

Issues that help most: your Claude Code version, your OS, and the output of `CW_DRY_RUN=1 cw ...`.
