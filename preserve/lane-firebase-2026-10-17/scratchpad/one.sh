#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite && npx vitest run --maxWorkers=1 test/operationsProcurementLiveSource.test.jsx -t "renders a live reorder" 2>&1 | grep -vE "^\s*$" | grep -vE "^\s+(at|❯) " | sed -n 1,50p | cut -c1-220
