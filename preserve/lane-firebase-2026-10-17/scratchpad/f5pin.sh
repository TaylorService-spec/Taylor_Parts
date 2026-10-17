#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f5 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
CMD=$(node -e 'const s=require("./package.json").scripts["test:adminPolicy"];console.log(s.replace(/^npm run build && /,"").replace("node --test","node --test --test-concurrency=2"))')
bash -c "$CMD" > /tmp/ap.out 2>&1; echo "adminPolicy unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/ap.out | head -10
