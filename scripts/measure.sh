#!/bin/sh
# Reproduce the cache numbers on your own repo: ./scripts/measure.sh <dirA> <dirB>
# Two directories with the same CLAUDE.md (sibling git worktrees are the real case). Costs a few cents (haiku).
# Prints tokens written to / read from the prompt cache, plain claude vs cw. Compare the two "second dir" lines.
# Run it in a fresh window: both modes share the 5-minute cache, so each is measured on its own text.
set -eu
a=${1:?dir A}; b=${2:?dir B}
q='reply with: ok'
show() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s),u=d.usage;console.log(`  written ${String(u.cache_creation_input_tokens).padStart(6)}  read ${String(u.cache_read_input_tokens).padStart(6)}  cost $${d.total_cost_usd.toFixed(3)}`)})'; }
run() { bin=$1; dir=$2; (cd "$dir" && $bin -p "$q" --model haiku --output-format json --max-budget-usd 0.5 < /dev/null | show); }
echo "plain claude, first dir (warms the cache):"; run claude "$a"
echo "plain claude, second dir:";                   run claude "$b"
echo "cw, first dir (warms the cache):";            run cw "$a"
echo "cw, second dir:";                             run cw "$b"
