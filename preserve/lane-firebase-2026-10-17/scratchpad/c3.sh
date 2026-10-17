#!/bin/bash
S=/mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
bash $S/full.sh work/eos-firebase-exit-c 2>&1 | grep -vE "exit=0 # pass [0-9]+ # fail 0"
cd ~/fbx; git show 6a677c42:docs/architecture/firebase-exit-baseline.json > /tmp/m.json; node scripts/firebaseExitGuard.mjs --previous-baseline=/tmp/m.json; git show 6a677c42:docs/architecture/firebase-shim-consumer-census.json > /tmp/mc.json; node scripts/firebaseShimBoundary.mjs --previous-census=/tmp/mc.json
bash $S/fnc.sh test/adminCredentialEligibility.test.mjs test/certificationAuthorityGenesis.test.mjs test/certificationGenesisRoleAdministration.test.mjs test/compactClaimsMirrorIntegrity.test.mjs test/conditionKindInventory.test.mjs test/equipmentCompatibilityRegistry.test.mjs test/schedulingAvailabilityModel.test.mjs test/shadowParityHarness.test.mjs test/catalogMaster.test.mjs
echo "== type commit byte proof (6a677c42 -> 92fede01)"
bash $S/libcmp.sh 6a677c42 92fede01
bash $S/distcmp.sh 6a677c42 92fede01
echo "== cleanup commit intended deltas (92fede01 -> 57b7a1f2)"
cd ~/fbx
for rev in 92fede01 57b7a1f2; do git checkout -q $rev; (cd functions && rm -rf lib && npm run -s build >/dev/null 2>&1 && rm -rf /tmp/lib-$rev && cp -a lib /tmp/lib-$rev); done
diff -rq /tmp/lib-92fede01 /tmp/lib-57b7a1f2
bash $S/distcmp.sh 92fede01 57b7a1f2 2>&1 | grep -E "differ|Only in|IDENTICAL"
