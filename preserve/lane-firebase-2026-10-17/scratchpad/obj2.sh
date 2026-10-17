#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > /tmp/obj2.log 2>&1
echo "load $(cut -d' ' -f1-3 /proc/loadavg)"
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f7a && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
CMD=$(node -e 'const s=require("./package.json").scripts["test:adminPolicy"];console.log(s.replace(/^npm run build && /,"").replace("node --test","node --test --test-concurrency=2"))')
bash -c "$CMD" > /tmp/ap.out 2>&1; echo "adminPolicy unit exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/ap.out | head -6
bash /mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad/pg.sh >/dev/null && echo "pg up"
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/postgres
for f in capabilityObjectAuthorityGuard workOrderAssignmentAuthorityPostgres workOrderNativeAuthorityPostgres workOrderObjectAuthorityPostgres workOrderLifecycleActivation workOrderMigrationCopyPostgres workOrderServicePersonaMatrixPostgres workOrderEquipmentInstallPostgres workOrderDomainCutoverPostgres workOrderJourneyAcceptancePostgres workOrderQuarantinePostgres serviceTechnicianJourneyPostgres serviceActivationAuthorityPostgres workOrderAvailabilityPostgres workOrderLaborPostgres workOrderFieldContextPostgres workOrderTechnicianJobContextPostgres workOrderAnalyticsPostgres inboundWorkPostgres sampleCompanyPostgres governedNonprodReplayPostgres roleCapabilityAuthorityBaselinePostgres returnIntakePostgres; do
  node --test --test-concurrency=1 test/$f.test.mjs > /tmp/w-$f.out 2>&1; echo "$f exit=$? $(grep -E '^# (pass|fail) ' /tmp/w-$f.out | tr '\n' ' ')"
done
/usr/lib/postgresql/16/bin/pg_ctl -D $HOME/fbx-pg stop -m fast >/dev/null && echo "pg stopped"
echo DONE
