#!/bin/bash
# usage: verify.sh <branch> <node test files...>
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
B=$1; shift
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts "$B" && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs scripts/firebaseCapabilityEquivalenceGuard.test.mjs 2>&1 | grep -E "^# (pass|fail)"
cd field-ops-app-vite
for t in "$@"; do node "$t" > /tmp/o 2>&1; rc=$?; echo "$t exit=$rc $(grep -E 'passed|^# (pass|fail)' /tmp/o | tr '\n' ' ')"; done
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep -E 'Found' /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"; tail -3 /tmp/t
npx vitest run > /tmp/v 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests " /tmp/v; grep -E "^ FAIL" /tmp/v | head
npm run -s build > /tmp/b 2>&1; echo "build exit=$?"
