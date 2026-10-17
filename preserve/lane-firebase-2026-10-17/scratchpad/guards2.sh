#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx || exit 1
git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-firebase-exit && git reset -q --hard FETCH_HEAD && git log --oneline -1
if [ "$1" = "write" ]; then node scripts/firebaseShimBoundary.mjs --write; cp docs/architecture/firebase-shim-consumer-census.json /mnt/d/eos-fb-exit/docs/architecture/firebase-shim-consumer-census.json; git diff --stat; fi
git show 93bec3b7:docs/architecture/firebase-exit-baseline.json > /tmp/main-baseline.json
node scripts/firebaseExitGuard.mjs --previous-baseline=/tmp/main-baseline.json; echo "guard exit $?"
git show 93bec3b7:docs/architecture/firebase-shim-consumer-census.json > /tmp/main-census.json
node scripts/firebaseShimBoundary.mjs --previous-census=/tmp/main-census.json; echo "shim exit $?"
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs scripts/firebaseCapabilityEquivalenceGuard.test.mjs > /tmp/guards.out 2>&1; echo "test exit $?"
grep -E "^# (tests|pass|fail)" /tmp/guards.out
grep -B2 -A25 "^not ok" /tmp/guards.out | grep -vE "^\s+at " | head -80
