#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f3 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd field-ops-app-vite
npx vitest run --maxWorkers=2 test/metadataRecordPage.test.jsx test/metadataUseMetadataListReadVia.test.jsx test/metadataCallableListSource.test.jsx test/accountPageComponents.test.jsx test/catalogMutationHold.test.jsx test/partMasterStructuredListScreen.test.jsx > /tmp/f3v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL" /tmp/f3v.out | head -20
node --test test/catalogClientCutover.test.mjs test/ciSuiteCoverage.test.mjs 2>&1 | grep -E "^# (pass|fail) "
npm test > /tmp/f3npm.out 2>&1; echo "npm test exit=$?"; tail -1 /tmp/f3npm.out
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"
npm run -s build > /tmp/b 2>&1; echo "build exit=$?"
