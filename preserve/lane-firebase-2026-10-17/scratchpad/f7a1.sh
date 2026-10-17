#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/tmp/b.out 2>&1; echo "build exit=$?"; grep "error TS" /tmp/b.out | head
node --test --test-concurrency=2 test/migrationLedgerOrderGuard.test.mjs test/administrationReadEnforcement.test.mjs test/personaBusinessAccessRegression.test.mjs test/operatorScriptEnvironmentFence.test.mjs test/eosOpsApiShape.test.mjs > /tmp/u.out 2>&1; echo "unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/u.out | head -20
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/returnIntakePostgres.test.mjs > /tmp/p.out 2>&1; echo "returns pg exit=$?"; grep -E "^# (pass|fail|skipped) |not ok" /tmp/p.out | head -20
node --test --test-concurrency=1 test/roleCapabilityAuthorityBaselinePostgres.test.mjs > /tmp/p2.out 2>&1; echo "baseline pg exit=$?"; grep -E "^# (pass|fail) |not ok" /tmp/p2.out | head -20
