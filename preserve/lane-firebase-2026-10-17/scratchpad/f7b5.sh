#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7b && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/tmp/b.out 2>&1; echo "build exit=$?"; grep "error TS" /tmp/b.out | head -5
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/crmActivityPostgres.test.mjs > /tmp/p.out 2>&1; echo "crmActivity pg exit=$?"; grep -E "^# (pass|fail) |not ok" /tmp/p.out | head; grep -B2 -A12 "not ok" /tmp/p.out | grep -E "error|expected|actual|message" | head -8
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
cd .. && node --test functions/test/crmAuthority.test.mjs 2>&1 | grep -E "^# (pass|fail) "
