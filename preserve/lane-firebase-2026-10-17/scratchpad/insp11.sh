#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && node scripts/firebaseExitGuard.mjs 2>&1 | tail -8
