#!/bin/bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
cd ~/fbx/field-ops-app-vite || exit 1
[ -d node_modules ] || cp -al ~/eos-filter-verify/field-ops-app-vite/node_modules node_modules
for t in "$@"; do case "$t" in
  *.mjs) node "$t" > /tmp/fe1.out 2>&1 || node --test "$t" > /tmp/fe1.out 2>&1; echo "$t exit $?"; grep -E "^# (pass|fail)|passed|failed|not ok" /tmp/fe1.out | head -5;;
esac; done
JSX=$(printf '%s\n' "$@" | grep '\.jsx$')
[ -n "$JSX" ] && { npx vitest run $JSX > /tmp/fe2.out 2>&1; echo "vitest exit $?"; grep -E "Test Files|Tests |FAIL|✗|×" /tmp/fe2.out | head -30; }
if [ -n "$BUILD" ]; then npm run build > /tmp/fe3.out 2>&1; echo "build exit $?"; tail -4 /tmp/fe3.out; fi
