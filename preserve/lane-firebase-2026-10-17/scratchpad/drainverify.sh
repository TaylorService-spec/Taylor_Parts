#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/fbx_gate
echo "drainverify bash $$ (cwd ~/fbx)" >> /tmp/fbx-pids.txt
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts fix/postgres-test-pool-drain && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build > /tmp/b.out 2>&1 || { echo BUILD FAIL; exit 1; }
echo "== 31 changed files outside test:adminPolicyPostgres (each alone)"
for f in canonicalCapabilityObjectMetadata capabilityGrantConditionsPostgres capabilityObjectAuthorityGuard contextualAuthorizationPostgres coordinatedVisitObjectRehome coordinatedVisitPostgresParity equipmentSampleSeedPostgres inboundProviderRuntimePostgres inboundWorkPostgres manufacturerAuthorityPostgres manufacturerRuntimeAuthorityPostgres objectSecurityAuthorityPostgres operatingCompanyBindingPostgres serviceActivationAuthorityPostgres serviceTechnicianJourneyPostgres stockLocationRetirementPostgres workOrderAnalyticsPostgres workOrderAssignmentAuthorityPostgres workOrderAvailabilityPostgres workOrderDomainCutoverPostgres workOrderEquipmentInstallPostgres workOrderFieldContextPostgres workOrderJourneyAcceptancePostgres workOrderLaborPostgres workOrderLifecycleActivation workOrderMigrationCopyPostgres workOrderNativeAuthorityPostgres workOrderQuarantinePostgres workOrderServicePersonaMatrixPostgres workOrderTechnicianJobContextPostgres; do

  node --test --test-concurrency=1 test/$f.test.mjs > /tmp/dv-$f.out 2>&1; rc=$?
  echo "$f exit=$rc $(grep -E '^# (pass|fail|skipped) ' /tmp/dv-$f.out | tr '\n' ' ')"; [ $rc -ne 0 ] && grep -m5 -E "not ok|rror|asynchronous" /tmp/dv-$f.out
done
echo "== full test:adminPolicyPostgres"
npm run -s test:adminPolicyPostgres > /tmp/dv-all.out 2>&1; echo "exit=$?"; grep -E "^# (tests|pass|fail|skipped) " /tmp/dv-all.out | tail -4; grep -E "^not ok" /tmp/dv-all.out | head
echo "terminating-connection FATALs during this run: $(awk -v t="$(date -d '-3 hours' '+%Y-%m-%d %H:%M')" '$0 >= t && /terminating connection/' ~/fbx-pg.log | wc -l) (since 3h ago, includes the earlier probe)"
