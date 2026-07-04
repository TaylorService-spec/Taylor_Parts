#!/usr/bin/env bash
# One-command Firebase Hosting preview channel deploy.
#
# Builds field-ops-app-vite with `base: "/"` (see vite.config.js's
# firebase-preview mode) -- NOT the same dist/ that GitHub Pages uses,
# which is built with base "/Taylor_Parts/field-ops/" and would 404 on
# every asset if served from a preview channel's own root URL.
#
# Usage: scripts/deploy-preview.sh [channel-name] [expires]
# Defaults: channel name = current git branch (slugified), expires = 7d.
set -euo pipefail
cd "$(dirname "$0")/.."

CHANNEL="${1:-$(git rev-parse --abbrev-ref HEAD | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//' | cut -c1-30)}"
EXPIRES_VALUE="${2:-7d}"

echo "==> Building Firebase-targeted bundle (base '/', outDir dist-firebase)..."
npm --prefix field-ops-app-vite run build:firebase

echo "==> Deploying preview channel '$CHANNEL' ($EXPIRES_VALUE)..."
firebase hosting:channel:deploy "$CHANNEL" --expires "$EXPIRES_VALUE"
