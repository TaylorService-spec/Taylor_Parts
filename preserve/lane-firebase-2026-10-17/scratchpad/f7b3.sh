#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7b && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head -5
cd field-ops-app-vite && npx vitest run --maxWorkers=2 test/crmClientCutover.test.jsx > /tmp/v.out 2>&1; echo "crmClientCutover exit=$?"; grep -E "Tests |×|FAIL" /tmp/v.out | head
node --test test/crmActivityView.test.mjs 2>&1 | grep -E "^# (pass|fail) " 
