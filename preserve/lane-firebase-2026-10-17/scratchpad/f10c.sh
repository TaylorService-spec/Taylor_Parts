#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f1-0 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1 || { echo BUILD FAIL; exit 1; }
node --test test/personaCapabilityParity.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok"
O=/mnt/d/eos-lanes/lane-firebase
node scripts/firebaseExit/personaCapabilityParity.mjs --captures $O/persona-capture --out $O/persona-capability-parity-2026-10-17.md --json $O/persona-capability-parity-2026-10-17.json --widen-note "administrator=explained by the 2026-10-17 governed business-role grant (EOS NEW set includes it; Firestore roleAssignments unchanged)"; echo "exit=$?"
grep -E "^Totals" $O/persona-capability-parity-2026-10-17.md
