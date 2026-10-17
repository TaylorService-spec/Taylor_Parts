#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx/functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
node --test --test-concurrency=2 test/operatorScriptEnvironmentFence.test.mjs test/eosOpsApiShape.test.mjs test/catalogMaster.test.mjs test/migrationLedgerOrderGuard.test.mjs test/ownerCapabilityContract.test.mjs > /tmp/u.out 2>&1; echo "unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/u.out | head
GOV=$(node -e 'const s=require("./package.json").scripts["test:governance"];console.log(s.replace(/^npm run build && /,"").replace("node --test","node --test --test-concurrency=2"))')
bash -c "$GOV" > /tmp/gov.out 2>&1; echo "governance exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/gov.out | head -5
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/returnIntakePostgres.test.mjs > /tmp/p.out 2>&1; echo "returns pg exit=$?"; grep -E "^# (pass|fail|skipped) |not ok" /tmp/p.out | head -10
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
cd ../field-ops-app-vite && npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
