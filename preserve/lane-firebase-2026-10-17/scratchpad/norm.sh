#!/bin/bash
for l in before after; do
  d=/tmp/norm-$l; rm -rf $d; mkdir -p $d
  src=/tmp/arch-$l/field-ops-app-vite/dist
  (cd $src && find . -type f ! -name version.json ! -name '*.map') | while read f; do
    n=$(echo "$f" | sed -E 's/-[A-Za-z0-9_-]{8}\.(js|css)$/-HASH.\1/'); mkdir -p "$d/$(dirname "$n")"
    sed -E 's/-[A-Za-z0-9_-]{8}\.(js|css)/-HASH.\1/g' "$src/$f" > "$d/$n"
  done
done
diff -rq /tmp/norm-before /tmp/norm-after
echo "normalized files: $(find /tmp/norm-after -type f | wc -l)"
diff <(tr '}' '\n' < /tmp/norm-before/assets/index-HASH.css) <(tr '}' '\n' < /tmp/norm-after/assets/index-HASH.css) | grep '^[<>]' | grep -c "fo-mfr__"
diff <(tr '}' '\n' < /tmp/norm-before/assets/index-HASH.css) <(tr '}' '\n' < /tmp/norm-after/assets/index-HASH.css) | grep '^[<>]' | grep -vc "fo-mfr__"
