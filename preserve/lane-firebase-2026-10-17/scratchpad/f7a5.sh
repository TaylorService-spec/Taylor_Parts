#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
node scripts/governance/buildContract.mjs >/dev/null && node scripts/governance/buildWorkbookV2.mjs >/dev/null && node scripts/governance/precedenceSweep.mjs >/dev/null && node scripts/governance/effectiveAuthority.mjs >/dev/null && node scripts/governance/capacityReport.mjs >/dev/null; echo "generators exit=$?"
git -C ~/fbx diff --stat -- docs; git -C ~/fbx diff -- docs > /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/gov2.patch
cd ../field-ops-app-vite
npx vitest run --maxWorkers=2 test/returnIntakeScan.test.jsx test/warehouseOfflineScreens.test.jsx test/putAwayOfflineAdoption.test.jsx > /tmp/v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL|×" /tmp/v.out | head -20
node --test test/inventoryScanPersonaWorkflows.test.mjs test/ciSuiteCoverage.test.mjs > /tmp/n.out 2>&1; echo "node exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/n.out | head
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"; grep error /tmp/t | head -3
npm run -s build > /tmp/b 2>&1; echo "build exit=$?"
