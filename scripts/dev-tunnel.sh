#!/usr/bin/env bash
# One-command external-access dev tunnel: starts the Vite dev server on a
# dedicated port (avoids colliding with any other locally-running dev
# server instances) and tunnels it via cloudflared, printing the public
# URL. Ctrl+C stops both the tunnel and the dev server it started.
#
# Requires cloudflared. If not on PATH, this looks for
# $HOME/bin/cloudflared.exe (see the one-liner below to fetch it once).
#
# Usage: npm run tunnel   (from field-ops-app-vite/)
#     or: scripts/dev-tunnel.sh
set -euo pipefail
cd "$(dirname "$0")/../field-ops-app-vite"

PORT="${DEV_TUNNEL_PORT:-5199}"

CLOUDFLARED="cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  if [ -x "$HOME/bin/cloudflared.exe" ]; then
    CLOUDFLARED="$HOME/bin/cloudflared.exe"
  else
    echo "cloudflared not found on PATH or at \$HOME/bin/cloudflared.exe."
    echo "Fetch it once with:"
    echo '  mkdir -p "$HOME/bin" && curl -sL -o "$HOME/bin/cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    exit 1
  fi
fi

# Free the dedicated port if a previous run of this script left something
# on it (e.g. a crashed dev server from an earlier session).
EXISTING_PID="$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess" 2>/dev/null | tr -d '[:space:]')"
if [ -n "$EXISTING_PID" ]; then
  echo "Port $PORT is in use by PID $EXISTING_PID -- stopping it..."
  powershell -NoProfile -Command "Stop-Process -Id $EXISTING_PID -Force" 2>/dev/null || true
  sleep 1
fi

echo "Starting Vite dev server on port $PORT..."
npm run dev -- --port "$PORT" --strictPort > "${TMPDIR:-/tmp}/dev-tunnel-vite.log" 2>&1 &
VITE_PID=$!

cleanup() {
  echo ""
  echo "Stopping dev server (pid $VITE_PID)..."
  kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for dev server to respond on port $PORT..."
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT/Taylor_Parts/field-ops/"; then
    echo "Dev server is up."
    break
  fi
  sleep 1
done

echo "Starting cloudflared tunnel -> http://localhost:$PORT ..."
"$CLOUDFLARED" tunnel --url "http://localhost:$PORT"
