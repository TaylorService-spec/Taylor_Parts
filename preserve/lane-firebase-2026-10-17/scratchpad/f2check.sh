#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg) mem-avail $(free -m | awk '/Mem/{print $7}')MB"
echo "f2check bash $$ (cwd ~/fbx)" >> /tmp/fbx-pids.txt
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f2 && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test --test-concurrency=2 scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs scripts/firebaseCapabilityEquivalenceGuard.test.mjs 2>&1 | grep -E "^# (pass|fail) "
cd field-ops-app-vite
npx vitest run --maxWorkers=2 test/operationsProcurementLiveSource.test.jsx test/operationsCanonicalNames.test.jsx test/operationsTransferOrders.test.jsx test/stockLocationSurfaceRetired.test.jsx test/operationsPanelsNames.test.jsx test/operationsQueriesTransferOrdersPage.test.jsx > /tmp/f2v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL|×" /tmp/f2v.out | head -20
node --test test/od3ClosureSource.test.mjs test/metadataProcurementDefinitions.test.mjs 2>&1 | grep -E "^# (pass|fail) "
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"; tail -5 /tmp/t
