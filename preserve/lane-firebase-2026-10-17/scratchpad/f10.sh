#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f1-0 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build > /tmp/b.out 2>&1 || { echo BUILD FAIL; tail /tmp/b.out; exit 1; }
node --test test/personaCapabilityParity.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok|error:|expected|actual" | head -20
