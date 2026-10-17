#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/fbx_gate
echo "loop20 bash $$ (cwd ~/fbx/functions)" >> /tmp/fbx-pids.txt
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts fix/assignment-scope-concurrency-flake && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build > /tmp/b.out 2>&1 || { echo BUILD FAIL; tail /tmp/b.out; exit 1; }
pass=0; fail=0
for i in $(seq 1 20); do
  if node --test --test-concurrency=1 test/assignmentScopeRuntimePostgres.test.mjs > /tmp/r20-$i.out 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); echo "run $i FAILED:"; grep -m3 -E "asynchronous|not ok|signal" /tmp/r20-$i.out; fi
done
echo "rebased fixed: $pass pass / $fail fail of 20"
echo "terminating-connection FATALs in ~/fbx-pg.log during this loop: $(awk -v t="$(date -d '-30 min' '+%Y-%m-%d %H:%M')" '$0 >= t && /terminating connection/' ~/fbx-pg.log | wc -l)"
