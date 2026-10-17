#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/tmp/b.out 2>&1; echo "build exit=$?"
CMD=$(node -e 'const s=require("./package.json").scripts["test:adminPolicy"];console.log(s.replace(/^npm run build && /,"").replace("node --test","node --test --test-concurrency=2"))')
bash -c "$CMD" > /tmp/ap.out 2>&1; echo "adminPolicy unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/ap.out | head -20
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
for f in roleCapabilityAuthorityBaselinePostgres governedNonprodReplayPostgres sampleCompanyPostgres authorityActivationVehiclePostgres; do
  node --test --test-concurrency=1 test/$f.test.mjs > /tmp/pg-$f.out 2>&1; echo "$f exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/pg-$f.out | head -8
done
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
