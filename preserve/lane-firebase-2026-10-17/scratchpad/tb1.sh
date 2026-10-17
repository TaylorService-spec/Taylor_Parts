#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts test/eos-fb-exit-rebaseline && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/adminPolicyCiRelevance.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
for f in coordinatedVisitObjectRehome manufacturerAuthorityPostgres manufacturerRuntimeAuthorityPostgres authorityPreviewSafetyPostgres authorityPreviewProtectedPostgres; do
  node --test --test-concurrency=1 test/$f.test.mjs > /tmp/t-$f.out 2>&1; echo "$f exit=$?"; grep -E "^# (pass|fail|skipped) |^not ok|^    not ok" /tmp/t-$f.out | head -6
done
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
