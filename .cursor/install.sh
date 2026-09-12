#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Enterprise Operations OS (Taylor Parts).
#
# Prepares the full local development experience:
#   - field-ops-app-vite  (React + Vite web client)
#   - functions           (Firebase Cloud Functions, compiled with tsc)
#   - firebase-tools       (Firestore/Auth/Functions emulators)
#   - Playwright Chromium  (headless browser used to drive the app)
#
# Safe to run repeatedly: every step checks before doing work, so re-running
# against a warm snapshot converges quickly instead of reinstalling from scratch.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { printf '\n=== %s ===\n' "$1"; }

log "Node / npm versions"
node -v
npm -v

# The Firestore emulator needs a JVM. It is present in the base image / snapshot;
# only try to install it (best effort) if it is genuinely missing.
if ! command -v java >/dev/null 2>&1; then
  log "Java runtime missing -- attempting install (needed by the Firestore emulator)"
  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update -y && sudo apt-get install -y --no-install-recommends default-jre-headless || \
      echo "WARNING: could not install Java automatically; install a JRE if the Firestore emulator fails to start."
  else
    echo "WARNING: java not found and sudo unavailable; install a JRE for the Firestore emulator."
  fi
else
  echo "java present: $(java -version 2>&1 | head -1)"
fi

log "Install web client dependencies (field-ops-app-vite)"
npm --prefix field-ops-app-vite install --no-audit --no-fund

log "Install Cloud Functions dependencies (functions)"
npm --prefix functions install --no-audit --no-fund

log "Compile Cloud Functions (tsc -> functions/lib)"
npm --prefix functions run build

log "Ensure firebase-tools CLI is available"
if command -v firebase >/dev/null 2>&1; then
  echo "firebase present: $(firebase --version)"
else
  echo "Installing firebase-tools@15.29.0"
  if command -v sudo >/dev/null 2>&1; then
    sudo env "PATH=$PATH" npm install -g --prefix /usr/local firebase-tools@15.29.0
  else
    npm install -g firebase-tools@15.29.0
  fi
fi

log "Ensure Playwright Chromium browser is installed"
# --with-deps is a no-op when the OS libraries are already present (e.g. on a snapshot).
npm --prefix field-ops-app-vite exec -- playwright install --with-deps chromium

log "Install complete"
