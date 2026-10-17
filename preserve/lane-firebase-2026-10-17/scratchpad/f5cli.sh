#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f5 && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head
cd field-ops-app-vite
npx vitest run --maxWorkers=2 test/manufacturersMetadataList.test.jsx test/catalogMutationHold.test.jsx test/partWriteModal.test.jsx test/partDetailInvalid.test.jsx test/partsNorthStarRecord.test.jsx test/partsNorthStarIdentity.test.jsx test/partMasterEmployeeWorkflow.test.jsx test/partsMasterDataEntryPoints.test.jsx test/queueConsolidationParity.test.jsx test/__visual__/renderPartsRecord.test.jsx test/__visual__/renderPartsWorkspace.test.jsx > /tmp/f5v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL|✗|×" /tmp/f5v.out | head -20
node --test test/navCutoverEnvironmentScoped.test.mjs test/partMasterManufacturersNavHidden.test.mjs test/manufacturerQueries.test.mjs test/manufacturerWrite.test.mjs test/manufacturerCatalogView.test.mjs test/catalogClientCutover.test.mjs test/ciSuiteCoverage.test.mjs test/financialsNavStructure.test.mjs > /tmp/f5n.out 2>&1; echo "node exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/f5n.out | head
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"; grep error /tmp/t | head -5
npm run -s build > /tmp/b 2>&1; echo "build exit=$?"
