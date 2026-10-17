#!/bin/bash
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)  nproc: $(nproc)"; free -m | sed -n 2p
for p in /proc/[0-9]*; do c=$(readlink $p/cwd 2>/dev/null); case "$c" in $HOME/fbx|$HOME/fbx/*) echo "MINE ${p#/proc/} $(tr '\0' ' ' < $p/cmdline | cut -c1-100)";; esac; done
ss -ltn | grep -c ":55507 " | sed 's/^/listening on 55507: /'
tail -3 /tmp/dv-all2.out 2>/dev/null; grep -E "^# (tests|pass|fail|skipped) " /tmp/dv-all2.out 2>/dev/null
