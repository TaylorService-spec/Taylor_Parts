#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite
grep -cE "Operations.jsx|partsOperationsReads|procurementDraftEngine|operationsQueries.ts|operationsProcurementLiveSource|operationsCanonicalNames|operationsTransferOrders" /tmp/l | sed 's/^/lint warnings in touched files: /'
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
npm test > /tmp/f2npm.out 2>&1; echo "npm test exit=$?"; tail -2 /tmp/f2npm.out
npm run -s build > /tmp/f2b.out 2>&1; echo "build exit=$?"
