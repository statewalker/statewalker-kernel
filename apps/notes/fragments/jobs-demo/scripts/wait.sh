#!/usr/bin/env bash
# Runs until it is cancelled; its child ignores SIGTERM (SIGKILL ends it after the grace period).
bash -c 'trap "" TERM; while true; do sleep 0.2; done' &
echo "child $!"
echo "self $$"
while true; do sleep 0.2; done
