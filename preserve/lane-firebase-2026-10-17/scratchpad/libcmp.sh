#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx
for rev in "$@"; do
  git checkout -q "$rev" && cd functions && rm -rf lib && npm run -s build > /tmp/fb.out 2>&1; rc=$?
  echo "$rev build exit=$rc files=$(find lib -type f | wc -l) sha=$(find lib -type f | sort | xargs sha256sum | sha256sum | cut -c1-64)"
  [ $rc -ne 0 ] && tail -5 /tmp/fb.out
  cd ..
done
