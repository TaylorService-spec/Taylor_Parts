#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git log --oneline -1
node scripts/syncAccessContracts.mjs --check
git show work/eos-firebase-exit-b:docs/architecture/firebase-exit-baseline.json > /tmp/pb.json 2>/dev/null || git show 6a677c42:docs/architecture/firebase-exit-baseline.json > /tmp/pb.json
node scripts/firebaseExitGuard.mjs --previous-baseline=/tmp/pb.json
git show 6a677c42:docs/architecture/firebase-shim-consumer-census.json > /tmp/pbc.json; node scripts/firebaseShimBoundary.mjs --previous-census=/tmp/pbc.json
cd functions
for t in "$@"; do node --test "$t" > /tmp/o 2>&1; rc=$?; echo "$t exit=$rc $(grep -E '^# (pass|fail)|passed' /tmp/o | tr '\n' ' ')"; done
