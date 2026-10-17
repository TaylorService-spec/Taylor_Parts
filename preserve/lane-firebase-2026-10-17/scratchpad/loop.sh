#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
/usr/lib/postgresql/16/bin/createdb -h 127.0.0.1 -p 55507 -U eos fbx_gate 2>/dev/null; export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/fbx_gate
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts fix/assignment-scope-concurrency-flake && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build > /tmp/b.out 2>&1 || { echo BUILD FAIL; tail /tmp/b.out; exit 1; }
cp test/assignmentScopeRuntimePostgres.test.mjs /tmp/fixed.test.mjs
git show HEAD~1:functions/test/assignmentScopeRuntimePostgres.test.mjs > test/zzOriginalAssignmentScope.test.mjs
for variant in original fixed; do
  f=test/assignmentScopeRuntimePostgres.test.mjs; [ $variant = original ] && f=test/zzOriginalAssignmentScope.test.mjs
  pass=0; fail=0
  for i in $(seq 1 30); do
    if node --test --test-concurrency=1 $f > /tmp/run-$variant-$i.out 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); grep -m1 -E "asynchronous activity|not ok" /tmp/run-$variant-$i.out; fi
  done
  echo "$variant: $pass pass / $fail fail of 30"
done
rm -f test/zzOriginalAssignmentScope.test.mjs
echo "== full adminPolicyPostgres"
npm run -s test:adminPolicyPostgres > /tmp/apall.out 2>&1; echo "test:adminPolicyPostgres exit=$?"; grep -E "^# (tests|pass|fail|skipped)" /tmp/apall.out | tail -5; grep -E "^not ok" /tmp/apall.out | head
