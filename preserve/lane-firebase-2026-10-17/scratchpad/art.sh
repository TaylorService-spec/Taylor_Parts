#!/bin/bash
# usage: art.sh <branch> -- regenerate graph, governance chain and shim census; run their guards; push changed artifacts on tmp/art-<short>
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > /tmp/art.log 2>&1
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts $1 && git reset -q --hard FETCH_HEAD && git log --oneline -1
node scripts/buildCapabilityGraph.mjs >/dev/null 2>&1; echo "buildCapabilityGraph=$?"
node scripts/firebaseShimBoundary.mjs --write >/dev/null 2>&1; echo "shim --write=$?"
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
for s in buildContract buildWorkbookV2 precedenceSweep effectiveAuthority; do node scripts/governance/$s.mjs >/dev/null 2>&1; echo "$s=$?"; done
cd ~/fbx && git status --short -- docs scripts functions/src
node --test scripts/firebaseShimBoundary.test.mjs scripts/firebaseExitGuard.test.mjs > /tmp/a1.out 2>&1; echo "shim+exit guards exit=$? $(grep -E '^# (pass|fail) ' /tmp/a1.out | tr '\n' ' ')"
cd functions
npm run -s test:governanceGuards > /tmp/a2.out 2>&1; echo "test:governanceGuards exit=$? $(grep -E '^# fail ' /tmp/a2.out | tr '\n' ' ')"
CMD=$(node -e 'const s=require("./package.json").scripts["test:governance"];console.log(s.replace(/^npm run build && /,""))')
bash -c "$CMD" > /tmp/a3.out 2>&1; echo "test:governance exit=$? $(grep -E '^# (pass|fail) ' /tmp/a3.out | tr '\n' ' ')"; grep -E "^not ok" /tmp/a3.out | head -5
cd ~/fbx
CHANGED=$(git status --porcelain -- docs/architecture/capability-graph.json docs/architecture/capability-graph.md docs/architecture/firebase-shim-consumer-census.json docs/governance)
if [ -n "$CHANGED" ]; then
  git add docs/architecture/capability-graph.json docs/architecture/capability-graph.md docs/architecture/firebase-shim-consumer-census.json docs/governance && git -c user.name="Rudy DiGiorgio" -c user.email="rudy.digiorgio@gmail.com" commit -q -m "chore: regenerate artifacts" && git push -q /mnt/d/Taylor_Parts HEAD:refs/heads/tmp/art-${1##*-} && echo "pushed tmp/art-${1##*-} $(git rev-parse --short HEAD)"
fi
echo DONE
