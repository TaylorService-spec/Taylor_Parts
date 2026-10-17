#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite
timeout 60 npx vitest run --maxWorkers=1 test/returnIntakeScan.test.jsx -t "records through" 2>&1 | grep -B3 -A25 "FAIL" | head -50
