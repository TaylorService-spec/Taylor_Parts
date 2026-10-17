#!/bin/bash
B=/usr/lib/postgresql/16/bin; D=$HOME/fbx-pg
if [ ! -d $D ]; then $B/initdb -D $D -U eos --auth=trust >/tmp/fbxpg-init.log 2>&1 || { tail /tmp/fbxpg-init.log; exit 1; }; fi
$B/pg_ctl -D $D -o "-p 55507 -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=200" -l $HOME/fbx-pg.log status >/dev/null || $B/pg_ctl -D $D -o "-p 55507 -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=200" -l $HOME/fbx-pg.log -w start
$B/psql -h 127.0.0.1 -p 55507 -U eos -d postgres -c "select version()" | head -3
