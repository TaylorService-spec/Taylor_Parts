#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"; free -m | sed -n 2p
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f5 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build > /tmp/f5b.out 2>&1; echo "build exit=$?"; grep -E "error TS" /tmp/f5b.out | head
node --test --test-concurrency=2 test/catalogRuntimeCensus.test.mjs test/catalogLane1Runtime.test.mjs test/catalogMutationHold.test.mjs > /tmp/f5u.out 2>&1; echo "unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/f5u.out | head
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/catalogReadAuthorizationPostgres.test.mjs test/manufacturerAuthorityPostgres.test.mjs test/manufacturerRuntimeAuthorityPostgres.test.mjs > /tmp/f5p.out 2>&1; echo "pg tests exit=$?"; grep -E "^# (pass|fail|skipped) |^not ok" /tmp/f5p.out | head -20
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
cd .. && node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head
