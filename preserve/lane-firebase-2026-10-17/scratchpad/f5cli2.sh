#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f5 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd field-ops-app-vite
npx vitest run --maxWorkers=2 test/manufacturersMetadataList.test.jsx > /tmp/f5v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL" /tmp/f5v.out | head; grep -A6 "FAIL" /tmp/f5v.out | head -20
node --test test/navCutoverEnvironmentScoped.test.mjs > /tmp/f5n.out 2>&1; echo "node exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/f5n.out | head
cd ../functions && npm run -s build >/dev/null 2>&1 && bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/manufacturerRuntimeAuthorityPostgres.test.mjs > /tmp/f5p.out 2>&1; echo "pg exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/f5p.out
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
