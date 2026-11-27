#!/usr/bin/env bash
# Prints its params, then N lines, one on stderr.
echo "params: $JOB_PARAMS"
n=$(node -e 'console.log(JSON.parse(process.env.JOB_PARAMS).n ?? 2)')
for i in $(seq 1 "$n"); do echo "line $i"; done
echo "a warning" >&2
