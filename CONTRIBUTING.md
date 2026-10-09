# Contributing

1. `npm install`
2. `npm run check` (typecheck + tests) must pass.
3. Behaviour change in `plan.ts`: add a test in `test/plan.test.ts`.
4. A change to the three flags needs a fresh measurement: `scripts/measure.sh <dirA> <dirB>`, paste the numbers in the PR.

Issues that help most: your Claude Code version, OS, and the output of `CW_DRY_RUN=1 cw ...`.
