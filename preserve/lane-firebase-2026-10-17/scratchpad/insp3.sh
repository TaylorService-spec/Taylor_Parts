#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/functions && node --test test/ownerCapabilityContract.test.mjs 2>&1 | grep -E "not ok|error|expected|actual|^\s+[+-] " | head -20
echo ====; sed -n 20,40p /tmp/pg-sampleCompanyPostgres.out
echo ====; grep -n "495\|496" /tmp/pg-governedNonprodReplayPostgres.out | head -5
