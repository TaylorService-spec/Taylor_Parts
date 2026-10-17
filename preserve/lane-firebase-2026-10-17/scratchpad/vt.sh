export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts work/eos-fb-exit-f1-0 && git reset -q --hard FETCH_HEAD && git log -1 --format=%h
cd field-ops-app-vite && timeout 300 npx vitest run test/metadataCallableListSource.test.jsx --maxWorkers=1 2>&1 | tail -5
