#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd field-ops-app-vite && npx vitest run --maxWorkers=2 test/returnIntakeScan.test.jsx test/warehouseOfflineScreens.test.jsx test/warehouseShell.test.jsx > /tmp/v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |×" /tmp/v.out | head -6
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"; npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"
cd ../functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/returnIntakePostgres.test.mjs > /tmp/p.out 2>&1; echo "returns pg exit=$?"; grep -E "^# (pass|fail) " /tmp/p.out
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
