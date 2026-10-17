#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/fbx_gate
echo "rerun2 bash $$ (cwd ~/fbx)" >> /tmp/fbx-pids.txt
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts fix/postgres-test-pool-drain && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build > /tmp/b.out 2>&1 || { echo BUILD FAIL; exit 1; }
for f in assignmentScopeRuntimePostgres crmAuthorityPostgres; do
  p=0; for i in 1 2 3 4 5; do node --test --test-concurrency=1 test/$f.test.mjs > /tmp/rr-$f-$i.out 2>&1 && p=$((p+1)) || grep -m3 -E "^not ok|error:" /tmp/rr-$f-$i.out; done; echo "$f: $p/5 pass"
done
