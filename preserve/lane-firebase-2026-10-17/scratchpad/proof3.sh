#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > /tmp/proof.log 2>&1
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7b && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/capabilityObjectAuthorityGuard.test.mjs test/adminPolicySeedCoverage.test.mjs test/crmActivityPostgres.test.mjs test/adminPolicyActivation.test.mjs test/adminPolicySeed.test.mjs > /tmp/proof.out 2>&1; echo "exit=$?"
grep -E "^# (pass|fail) |^not ok|^ok |^    ok |^    not ok " /tmp/proof.out
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
echo DONE
