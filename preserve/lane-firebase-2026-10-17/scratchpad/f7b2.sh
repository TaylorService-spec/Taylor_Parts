#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7b && git reset -q --hard FETCH_HEAD && git log --oneline -1
node --test scripts/firebaseExitGuard.test.mjs scripts/firebaseShimBoundary.test.mjs 2>&1 | grep -E "^# (pass|fail) |^not ok" | head -5
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
node --test --test-concurrency=2 test/crmAuthority.test.mjs test/ownerCapabilityContract.test.mjs > /tmp/u.out 2>&1; echo "unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/u.out | head
node scripts/governance/buildContract.mjs >/dev/null && node scripts/governance/buildWorkbookV2.mjs >/dev/null && node scripts/governance/precedenceSweep.mjs >/dev/null && node scripts/governance/effectiveAuthority.mjs >/dev/null && node scripts/governance/capacityReport.mjs >/dev/null; echo "generators exit=$?"
git -C ~/fbx diff --stat -- docs; git -C ~/fbx diff -- docs > /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/f7b_gen2.patch
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
node --test --test-concurrency=1 test/governedNonprodReplayPostgres.test.mjs > /tmp/g.out 2>&1; echo "replay exit=$?"; grep -E "^# (pass|fail) |expected|actual" /tmp/g.out | head -4
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
cd ../field-ops-app-vite
npx vitest run --maxWorkers=2 test/activityAndNotesSection.test.jsx test/useCrmActivityActions.test.jsx test/accountPageComponents.test.jsx test/uiCorrectionsShared.test.jsx > /tmp/v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |×" /tmp/v.out | head -10
ls test | grep -i "crmClient\|crmActivity" 
node --test test/ciSuiteCoverage.test.mjs test/metadataAccountPageDefinition.test.mjs > /tmp/n.out 2>&1; echo "node exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/n.out | head
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
npm run -s typecheck > /tmp/t 2>&1; echo "tsc exit=$?"
