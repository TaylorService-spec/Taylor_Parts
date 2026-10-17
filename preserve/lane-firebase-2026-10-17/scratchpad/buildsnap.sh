#!/bin/bash
# usage: buildsnap.sh <branch> <label>
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts "$1" && git reset -q --hard FETCH_HEAD && git log --oneline -1
[ -d functions/node_modules ] || cp -al ~/eos-filter-verify/functions/node_modules functions/node_modules
(cd functions && rm -rf lib && npm run -s build > /tmp/fb.out 2>&1; echo "functions build exit=$?"; tail -3 /tmp/fb.out)
(cd field-ops-app-vite && rm -rf dist && npm run -s build > /tmp/vb.out 2>&1; echo "vite build exit=$?")
rm -rf /tmp/snap-$2 && mkdir -p /tmp/snap-$2 && cp -a functions/lib /tmp/snap-$2/lib && cp -a field-ops-app-vite/dist /tmp/snap-$2/dist
(cd /tmp/snap-$2 && find lib dist -type f | wc -l)
