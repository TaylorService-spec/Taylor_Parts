#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx
for pair in "before:$1" "after:$2"; do
  label=${pair%%:*}; rev=${pair#*:}
  d=/tmp/arch-$label; rm -rf $d; mkdir -p $d
  git archive "$rev" field-ops-app-vite config scripts functions/src functions/package.json | tar -x -C $d; ln -s ~/fbx/functions/node_modules $d/functions/node_modules
  ln -s ~/fbx/field-ops-app-vite/node_modules $d/field-ops-app-vite/node_modules
  (cd $d/field-ops-app-vite && npm run -s build > /tmp/ab-$label.out 2>&1; echo "$label ($rev) build exit=$?")
done
diff -rq --exclude=version.json /tmp/arch-before/field-ops-app-vite/dist /tmp/arch-after/field-ops-app-vite/dist && echo "DIST IDENTICAL (excluding version.json)"
for l in before after; do (cd /tmp/arch-$l/field-ops-app-vite/dist && find . -type f ! -name version.json | sort | xargs sha256sum | sha256sum; find . -type f | wc -l); done
diff <(jq 'del(.buildTime)' /tmp/arch-before/field-ops-app-vite/dist/version.json 2>/dev/null || grep -v buildTime /tmp/arch-before/field-ops-app-vite/dist/version.json) <(jq 'del(.buildTime)' /tmp/arch-after/field-ops-app-vite/dist/version.json 2>/dev/null || grep -v buildTime /tmp/arch-after/field-ops-app-vite/dist/version.json) && echo "version.json identical apart from buildTime"
