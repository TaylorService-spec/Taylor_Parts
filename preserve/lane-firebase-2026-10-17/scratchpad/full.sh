#!/bin/bash
# usage: full.sh <branch> <log>
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > $2 2>&1
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts $1 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
CMD=$(node -e 'const s=require("./package.json").scripts["test:adminPolicy"];console.log(s.replace(/^npm run build && /,"").replace("node --test","node --test --test-concurrency=2"))')
bash -c "$CMD" > /tmp/full-unit.out 2>&1; echo "unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/full-unit.out | head -8
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
CMD=$(node -e 'const s=require("./package.json").scripts["test:adminPolicyPostgres"];console.log(s.replace(/^npm run build && /,""))')
bash -c "$CMD" > /tmp/full-pg.out 2>&1; echo "pg suite exit=$?"; grep -E "^# (pass|fail) |^not ok|^    not ok" /tmp/full-pg.out | head -30
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
echo DONE
