# Contributing

1. `npm install`
2. `npm run check` (types, unit tests, and an end-to-end suite that installs the packed tarball and runs `cw` against a fake `claude`) must pass.
   Real Claude, real API, a few cents: `npm run e2e:real` (needs `claude` logged in; asserts the second folder writes at least 5x fewer cache tokens).
3. Behaviour change in `plan.ts`: add a test in `test/plan.test.ts`.
4. A change to the three flags needs a fresh measurement: `scripts/measure.sh <dirA> <dirB>`, paste the numbers in the PR.

Issues that help most: your Claude Code version, OS, and the output of `CW_DRY_RUN=1 cw ...`.
