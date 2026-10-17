#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
export POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55507/fbx_gate
echo "full2 bash $$ (cwd ~/fbx)" >> /tmp/fbx-pids.txt
cd ~/fbx && git log --oneline -1 && cd functions
before=$(grep -c "terminating connection" ~/fbx-pg.log)
npm run -s test:adminPolicyPostgres > /tmp/dv-all2.out 2>&1; echo "exit=$?"; grep -E "^# (tests|pass|fail|skipped) " /tmp/dv-all2.out | tail -4; grep -E "^not ok" /tmp/dv-all2.out | head
echo "new terminating-connection FATALs during this run: $(( $(grep -c "terminating connection" ~/fbx-pg.log) - before ))"
