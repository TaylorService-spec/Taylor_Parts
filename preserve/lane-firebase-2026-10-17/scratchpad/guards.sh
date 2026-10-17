#!/bin/bash
set -o pipefail
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
rm -rf ~/fbx && git -c core.autocrlf=false clone -q --branch work/eos-firebase-exit /mnt/d/Taylor_Parts ~/fbx && cd ~/fbx || exit 1
git log --oneline -1; node -v
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs scripts/firebaseCapabilityEquivalenceGuard.test.mjs > /tmp/guards.out 2>&1; echo "test exit $?"
grep -E "^# (tests|pass|fail)" /tmp/guards.out
grep -B2 -A25 "^not ok" /tmp/guards.out | grep -vE "^\s+at " | head -150
