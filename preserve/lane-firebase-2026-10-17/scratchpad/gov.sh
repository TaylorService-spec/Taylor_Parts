#!/bin/bash
# usage: gov.sh <branch> -- regenerate the governance artifacts, commit them on refs/heads/tmp/gov-<short> in the shared repo
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
exec > /tmp/gov.log 2>&1
cd ~/fbx && git -c gc.auto=0 fetch -q /mnt/d/Taylor_Parts $1 && git reset -q --hard FETCH_HEAD && git log --oneline -1
cd functions && npm run -s build >/dev/null 2>&1; echo "build exit=$?"
for s in buildContract buildWorkbookV2 precedenceSweep effectiveAuthority; do node scripts/governance/$s.mjs >/dev/null 2>&1; echo "$s=$?"; done
cd ~/fbx && git status --short
if [ -n "$(git status --porcelain -- docs/governance)" ]; then
  git add docs/governance && git -c user.name="Rudy DiGiorgio" -c user.email="rudy.digiorgio@gmail.com" commit -q -m "chore(governance): regenerate governance artifacts" && git push -q /mnt/d/Taylor_Parts HEAD:refs/heads/tmp/gov-${1##*-} && echo "pushed tmp/gov-${1##*-} $(git rev-parse --short HEAD)"
fi
echo DONE
