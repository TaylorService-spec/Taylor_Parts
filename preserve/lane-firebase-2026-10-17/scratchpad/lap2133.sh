#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head -5
cd functions && npm run -s build >/tmp/b.out 2>&1; echo "build exit=$?"; grep "error TS" /tmp/b.out | head -3
GOV=$(node -e 'const s=require("./package.json").scripts["test:governance"];console.log(s.replace(/^npm run build && /,"").replace(/ && git diff --exit-code.*$/,"").replace("node --test","node --test --test-concurrency=2"))')
bash -c "$GOV" > /tmp/gov.out 2>&1; echo "governance exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/gov.out | head -4
cd ~/fbx && node scripts/buildCapabilityGraph.mjs >/dev/null 2>&1; git diff --stat -- docs; git diff -- docs > /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/lap_gen.patch
cd functions && node --test --test-concurrency=2 test/eosOpsApiShape.test.mjs test/catalogRuntimeCensus.test.mjs test/experienceAuthority.test.mjs test/reorderQueueNavigation.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head -5
cd ../field-ops-app-vite
npx vitest run --maxWorkers=2 test/returnIntakeScan.test.jsx test/warehouseOfflineScreens.test.jsx test/putAwayOfflineAdoption.test.jsx test/manufacturersMetadataList.test.jsx > /tmp/v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |×" /tmp/v.out | head -8
ls test | grep -i "warehouseShell" | head -3
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"
npm run -s build > /tmp/bb 2>&1; echo "build exit=$?"
