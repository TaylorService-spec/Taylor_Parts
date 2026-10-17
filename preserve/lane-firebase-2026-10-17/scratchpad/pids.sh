#!/bin/bash
out=/tmp/fbx-pids.txt; : > $out
echo "postgres $(head -1 $HOME/fbx-pg/postmaster.pid) (pg_ctl -D ~/fbx-pg, :55507)" >> $out
for p in /proc/[0-9]*; do c=$(readlink $p/cwd 2>/dev/null); case "$c" in $HOME/fbx|$HOME/fbx/*) echo "${p#/proc/} $(tr '\0' ' ' < $p/cmdline | cut -c1-120) [cwd $c]" >> $out;; esac; done
cat $out
