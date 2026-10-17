#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f5 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/tmp/b.out 2>&1; echo "build exit=$?"
node scripts/governance/buildContract.mjs >/dev/null && node scripts/governance/buildWorkbookV2.mjs >/dev/null && node scripts/governance/precedenceSweep.mjs >/dev/null && node scripts/governance/effectiveAuthority.mjs >/dev/null && node scripts/governance/capacityReport.mjs >/dev/null; echo "generators exit=$?"
git -C ~/fbx diff --stat -- docs/governance; git -C ~/fbx diff -- docs/governance > /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/gov.patch
node --test --test-concurrency=2 test/experienceAuthority.test.mjs test/catalogRuntimeCensus.test.mjs test/catalogMaster.test.mjs > /tmp/u.out 2>&1; echo "unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/u.out | head
cd ../field-ops-app-vite
npx vitest run --maxWorkers=2 test/manufacturersMetadataList.test.jsx test/listsP2Tranche1.test.jsx > /tmp/v.out 2>&1; echo "vitest exit=$?"; grep -E "Test Files|Tests |FAIL" /tmp/v.out | head
node --test test/navCutoverEnvironmentScoped.test.mjs test/salesAgreementsAndNavCutover.test.mjs test/partMasterManufacturersNavHidden.test.mjs test/manufacturerQueries.test.mjs > /tmp/n.out 2>&1; echo "node exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/n.out | head
npm run -s lint > /tmp/l 2>&1; echo "lint exit=$? $(grep Found /tmp/l)"
