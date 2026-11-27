#!/usr/bin/env bash
# Counts to `n` (JOB_PARAMS), one line each, and says so on stderr when done.
n=$(node -e 'console.log(JSON.parse(process.env.JOB_PARAMS || "{}").n ?? 3)')
for i in $(seq 1 "$n"); do echo "count $i"; done
echo "counted to $n" >&2
