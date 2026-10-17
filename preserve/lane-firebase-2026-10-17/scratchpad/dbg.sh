#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite && cp /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/dbg.test.jsx test/zzdbg.test.jsx
timeout 60 npx vitest run --maxWorkers=1 test/zzdbg.test.jsx 2>&1 | grep -E "opts calls|rec |Error|FAIL|passed|failed" | head -20
rm -f test/zzdbg.test.jsx
