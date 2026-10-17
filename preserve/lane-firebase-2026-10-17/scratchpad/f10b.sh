#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f1-0 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd field-ops-app-vite && npx vitest run --maxWorkers=2 test/metadataCallableListSource.test.jsx test/suppliersSurface.test.jsx > /tmp/v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL" /tmp/v.out | head
cd ../functions && npm run -s build >/dev/null 2>&1 && node --test test/personaCapabilityParity.test.mjs 2>&1 | grep -E "^# (pass|fail) "
