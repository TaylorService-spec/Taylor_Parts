#!/bin/bash
for f in /tmp/run-fixed-*.out; do
  if grep -q "^not ok" "$f"; then echo "== $f"; grep -nE "not ok|rror|asynchronous|expected|actual|test.mjs:[0-9]" "$f" | head -40; fi
done
