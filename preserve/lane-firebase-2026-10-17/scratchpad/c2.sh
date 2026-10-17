#!/bin/bash
S=/mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad
bash $S/full.sh work/eos-firebase-exit-c 2>&1 | grep -vE "exit=0 # pass [0-9]+ # fail 0"
bash $S/fnc.sh test/adminCredentialEligibility.test.mjs test/certificationAuthorityGenesis.test.mjs test/certificationGenesisRoleAdministration.test.mjs test/compactClaimsMirrorIntegrity.test.mjs test/conditionKindInventory.test.mjs test/equipmentCompatibilityRegistry.test.mjs test/schedulingAvailabilityModel.test.mjs test/shadowParityHarness.test.mjs test/catalogMaster.test.mjs


