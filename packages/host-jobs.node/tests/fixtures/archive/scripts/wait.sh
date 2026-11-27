#!/usr/bin/env bash
# Starts a child that ignores SIGTERM, reports both pids, then waits.
bash -c 'trap "" TERM; while true; do sleep 0.1; done' &
echo "child $!"
echo "self $$"
trap 'echo "terminated"; exit 143' TERM
while true; do sleep 0.1; done
