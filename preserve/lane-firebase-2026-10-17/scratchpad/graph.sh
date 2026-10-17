#!/bin/bash
# usage: graph.sh <branch> -- regenerate the capability graph, run the governance guard suites, push the artifact on tmp/graph-<short>
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > /tmp/graph.log 2>&1
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts $1 && git reset -q --hard FETCH_HEAD && git log --oneline -1
node scripts/buildCapabilityGraph.mjs >/dev/null 2>&1; echo "buildCapabilityGraph=$?"
git status --short -- docs/architecture
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
for s in buildContract buildWorkbookV2 precedenceSweep effectiveAuthority; do node scripts/governance/$s.mjs >/dev/null 2>&1; echo "$s=$?"; done
cd ~/fbx && echo "governance artifacts changed: $(git status --porcelain -- docs/governance | wc -l)"
cd functions
node --test test/capabilityGraphDrift.test.mjs > /tmp/g1.out 2>&1; echo "capabilityGraphDrift exit=$? $(grep -E '^# (pass|fail) ' /tmp/g1.out | tr '\n' ' ')"
npm run -s test:governanceGuards > /tmp/g2.out 2>&1; echo "test:governanceGuards exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/g2.out | tr '\n' ' '; echo
CMD=$(node -e 'const s=require("./package.json").scripts["test:governance"];console.log(s.replace(/^npm run build && /,""))')
bash -c "$CMD" > /tmp/g3.out 2>&1; echo "test:governance exit=$?"; grep -E "^# (pass|fail) |^not ok" /tmp/g3.out | tr '\n' ' '; echo
cd ~/fbx
if [ -n "$(git status --porcelain -- docs/architecture/capability-graph.json docs/architecture/capability-graph.md)" ]; then
  git add docs/architecture/capability-graph.json docs/architecture/capability-graph.md && git -c user.name="Rudy DiGiorgio" -c user.email="rudy.digiorgio@gmail.com" commit -q -m "chore: regenerate capability graph" && git push -q /mnt/d/Taylor_Parts HEAD:refs/heads/tmp/graph-${1##*-} && echo "pushed tmp/graph-${1##*-} $(git rev-parse --short HEAD)"
fi
echo DONE
