#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && head -30 scripts/buildCapabilityGraph.mjs | grep -n "Usage\|node \|--" | head -5
node scripts/buildCapabilityGraph.mjs >/tmp/cg.out 2>&1; echo "gen exit=$?"; tail -3 /tmp/cg.out
git status --short docs | head; git diff --stat -- docs
git diff -- docs/architecture > /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/cg.patch
cd functions && node --test test/capabilityGraphDrift.test.mjs test/administrationObjectDrift.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok"
