#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite
for t in "starts by scanning" "records through" "HAS NO DEFAULT" "one company is chosen" "NOBODY GUESSES" "no company authority" "OFFLINE, the last"; do
  timeout 60 npx vitest run --maxWorkers=1 test/returnIntakeScan.test.jsx -t "$t" > /tmp/one.out 2>&1; echo "[$t] exit=$? $(grep -cE 'heap out of memory' /tmp/one.out) $(grep -E 'Tests ' /tmp/one.out)"
done
