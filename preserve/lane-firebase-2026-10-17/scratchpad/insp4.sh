#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/functions && node test/ownerCapabilityContract.test.mjs 2>&1 | grep -v "^  ok" | head -30
