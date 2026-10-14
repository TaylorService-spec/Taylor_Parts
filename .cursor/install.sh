#!/usr/bin/env bash
# Cloud Agent install — Node packages + PostgreSQL client/server.
# No Firebase CLI, emulator, or production credentials.
set -euo pipefail

cd /workspace

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    postgresql postgresql-contrib postgresql-client
fi

npm ci --prefix field-ops-app-vite --no-audit --no-fund
npm ci --prefix functions --include=dev --no-audit --no-fund
npm run build --prefix functions
