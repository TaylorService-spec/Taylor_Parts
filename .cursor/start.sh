#!/usr/bin/env bash
# Per-boot service reconciliation for the Enterprise Operations OS dev stack.
#
# Brings up the local sandbox the app runs against and returns (it does not hold
# the foreground). Idempotent: if a service is already listening it is left alone,
# so re-running on an already-started machine is a no-op rather than a duplicate.
#
#   1. Firebase emulators (Firestore :8080, Auth :9099, Functions :5001, UI :4000)
#   2. Seed the emulator with driver test accounts + inventory fixtures
#
# The Vite dev server itself runs as a visible `terminals` process (see
# .cursor/environment.json) so its logs and lifecycle stay inspectable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_DIR="$REPO_ROOT/field-ops-app-vite/.claude/skills/run-field-ops-app-vite"
EMU_LOG="/tmp/eos-emulator.log"

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0 || return 1; }

if listening 8080 && listening 9099 && listening 5001; then
  echo "Firebase emulators already listening (8080/9099/5001) -- leaving them running."
else
  echo "Starting Firebase emulators (functions,firestore,auth)..."
  cd "$SKILL_DIR"
  # Fully detach so the emulator survives after this start script returns.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup node emulator.mjs start functions,firestore,auth >"$EMU_LOG" 2>&1 &
  else
    nohup node emulator.mjs start functions,firestore,auth >"$EMU_LOG" 2>&1 &
  fi
  disown || true
  # Bounded wait for the launcher's own readiness signal.
  for _ in $(seq 1 90); do
    if grep -q "EMULATOR READY" "$EMU_LOG" 2>/dev/null; then break; fi
    if grep -q "FAIL-CLOSED\|process exited" "$EMU_LOG" 2>/dev/null; then
      echo "ERROR: emulator failed to start. Log tail:"; tail -20 "$EMU_LOG"; exit 1
    fi
    sleep 2
  done
  if ! grep -q "EMULATOR READY" "$EMU_LOG" 2>/dev/null; then
    echo "ERROR: emulator did not become ready in time. Log tail:"; tail -20 "$EMU_LOG"; exit 1
  fi
  echo "Emulators ready. Seeding driver accounts + inventory fixtures..."
  cd "$REPO_ROOT/field-ops-app-vite"
  node "$SKILL_DIR/seed.mjs" >/tmp/eos-seed.log 2>&1 || { echo "ERROR: seed failed"; tail -20 /tmp/eos-seed.log; exit 1; }
  echo "Seed complete."
fi

cat <<'EOF'

EOS dev sandbox is up.
  Web app (dev):   http://localhost:5173/Taylor_Parts/field-ops/?emulator=1
  Emulator UI:     http://localhost:4000
  Sign-in (seeded, emulator-only):
    admin ................ driver-admin@example.test / driver-pass-123
    parts manager ........ driver-parts-manager@example.test / driver-pass-123
EOF
