#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
grep -n -A25 "^not ok 457" /tmp/ap.out | grep -E "location|error|expected|actual|\+ |\- " | head -14
cd ~/fbx/functions && node test/ownerCapabilityContract.test.mjs 2>&1 | grep -A4 "FAIL" | head -12
grep -E "expected|actual" /tmp/pg-governedNonprodReplayPostgres.out | head -4
