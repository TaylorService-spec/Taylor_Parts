#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite && git -C ~/fbx log --oneline -1
sed -n 25,50p test/returnIntakeScan.test.jsx
timeout 90 npx vitest run --maxWorkers=1 --testTimeout=30000 test/returnIntakeScan.test.jsx -t "records through" 2>&1 | grep -E "Error|FAIL|passed|failed|Duration" | head
