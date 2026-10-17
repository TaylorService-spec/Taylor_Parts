#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/fbx_gate
cd ~/fbx/functions && git show bd77a454:functions/test/manufacturerRuntimeAuthorityPostgres.test.mjs > test/zzMainManufacturerRuntimeAuthorityPostgres.test.mjs
node --test test/zzMainManufacturerRuntimeAuthorityPostgres.test.mjs > /tmp/main-mra.out 2>&1; echo "main version exit=$? $(grep -E '^# (pass|fail) ' /tmp/main-mra.out | tr '\n' ' ')"; grep -E "^not ok|expected:|actual:" /tmp/main-mra.out | head -6
rm -f test/zzMainManufacturerRuntimeAuthorityPostgres.test.mjs
