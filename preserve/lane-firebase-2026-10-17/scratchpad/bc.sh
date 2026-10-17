#!/bin/bash
S=/mnt/c/Users/Rudy2/AppData/Local/Temp/claude/D--eos-fb-exit/90e44a1d-ecbf-4664-829d-20eac9a85290/scratchpad
for b in work/eos-firebase-exit-b work/eos-firebase-exit-c; do bash $S/full.sh $b 2>&1 | grep -vE "exit=0 # pass [0-9]+ # fail 0"; done
sed -i "s/a100ccfa/07e29d35/g" $S/fnc.sh
bash $S/fnc.sh test/adminCredentialEligibility.test.mjs test/compactClaimsMirrorIntegrity.test.mjs test/schedulingAvailabilityModel.test.mjs test/shadowParityHarness.test.mjs
bash $S/libcmp.sh 07e29d35 0126e4de
bash $S/distcmp.sh 07e29d35 0126e4de
