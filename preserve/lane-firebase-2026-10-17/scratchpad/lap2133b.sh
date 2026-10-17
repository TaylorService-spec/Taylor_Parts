#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; node scripts/governance/precedenceSweep.mjs >/dev/null; git -C ~/fbx diff --stat -- docs | tail -1; echo "(empty = sweep committed)"
cd ../field-ops-app-vite && npx vitest run --maxWorkers=2 test/warehouseShell.test.jsx > /tmp/v.out 2>&1; echo "warehouseShell exit=$?"; grep -E "Tests |×" /tmp/v.out | head -3
