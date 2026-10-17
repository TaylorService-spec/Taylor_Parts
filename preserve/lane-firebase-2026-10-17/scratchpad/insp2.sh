#!/bin/bash
ls -l --time-style=+%H:%M:%S /tmp/run-fixed-13.out /tmp/run-fixed-14.out /tmp/run-fixed-15.out 2>/dev/null
date +%H:%M:%S
dmesg 2>/dev/null | grep -iE "oom|killed process" | tail -5 || echo "dmesg unavailable"
free -m | head -2
ps -eo pid,etimes,args --sort=-etimes | grep -E "node|pkill|kill " | grep -v grep | cut -c1-160 | head -15
grep -nE "terminating|FATAL" ~/fbx-pg.log | tail -5
