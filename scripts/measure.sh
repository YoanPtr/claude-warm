#!/bin/sh
# Reproduce the cache numbers: ./scripts/measure.sh <dirA> <dirB>
# Two directories with the same CLAUDE.md (sibling git worktrees are the real case). Costs a few cents (haiku).
# Prints tokens written to / read from the prompt cache for the SECOND directory, plain claude vs cw.
# Run the plain one FIRST in a fresh window: both modes share the 5-minute cache, so each is measured on its own text.
set -eu
a=${1:?dir A}; b=${2:?dir B}
q='reply with: ok'
show() { python3 -c 'import sys,json; d=json.load(sys.stdin); u=d["usage"]; print("  written %6d  read %6d  cost $%.3f" % (u["cache_creation_input_tokens"], u["cache_read_input_tokens"], d["total_cost_usd"]))'; }
run_plain() { (cd "$1" && claude -p "$q" --model haiku --output-format json --max-budget-usd 0.5 < /dev/null | show); }
run_cw() { (cd "$1" && cw -p "$q" --model haiku --output-format json --max-budget-usd 0.5 < /dev/null | show); }
echo "plain claude, first dir (warms the cache):"; run_plain "$a"
echo "plain claude, second dir:";                   run_plain "$b"
echo "cw, first dir (warms the cache):";            run_cw "$a"
echo "cw, second dir:";                             run_cw "$b"
