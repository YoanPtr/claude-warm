#!/usr/bin/env node
// Stand-in for `claude`: records what it was started with, exits with FAKE_EXIT.
import { writeFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const i = args.indexOf('--append-system-prompt-file');
writeFileSync(process.env.FAKE_OUT, JSON.stringify({
  args,
  cwd: process.cwd(),
  appended: i >= 0 ? readFileSync(args[i + 1], 'utf8') : null,
  seenEnv: process.env.CW_TEST_VAR ?? null,
}));
process.exit(Number(process.env.FAKE_EXIT ?? 0));
