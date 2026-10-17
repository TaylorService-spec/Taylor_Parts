#!/bin/bash
grep -n -A25 "FAIL .*A REFUSAL IS NEVER QUEUED" /tmp/v.out | head -40
cd ~/fbx && export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin && node --test scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -A20 "^not ok" | grep -E "error|expected|actual|\+|\-" | head -20
