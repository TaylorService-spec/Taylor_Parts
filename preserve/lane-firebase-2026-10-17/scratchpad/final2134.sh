#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > /tmp/final2134.log 2>&1
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7b && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/crmTransportPostgres.test.mjs test/crmCustomerPostgres.test.mjs test/crmActivityPostgres.test.mjs > /tmp/f1.out 2>&1; echo "crm pg exit=$? $(grep -E '^# (pass|fail) ' /tmp/f1.out | tr '\n' ' ')"; grep -E "^not ok|^    not ok" /tmp/f1.out | head
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
CMD=$(node -e 'const s=require("./package.json").scripts["test:governance"];console.log(s.replace(/^npm run build && /,""))')
bash -c "$CMD" > /tmp/f2.out 2>&1; echo "test:governance exit=$? $(grep -E '^# (pass|fail) ' /tmp/f2.out | tr '\n' ' ')"
npm run -s test:governanceGuards > /tmp/f3.out 2>&1; echo "test:governanceGuards exit=$?"
cd ~/fbx && node --test scripts/firebaseShimBoundary.test.mjs scripts/firebaseExitGuard.test.mjs > /tmp/f4.out 2>&1; echo "shim+exit exit=$? $(grep -E '^# (pass|fail) ' /tmp/f4.out | tr '\n' ' ')"
cd field-ops-app-vite && npx vitest run test/crmClientCutover.test.jsx test/activityAndNotesSection.test.jsx test/activitySection.test.jsx test/crmActivityView.test.mjs test/useCrmActivityActions.test.jsx test/returnIntakeScan.test.jsx test/warehouseOfflineScreens.test.jsx test/inventoryScanPersonaWorkflows.test.mjs > /tmp/f5.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests " /tmp/f5.out
cd ~/fbx && git status --short | head -5
echo DONE
