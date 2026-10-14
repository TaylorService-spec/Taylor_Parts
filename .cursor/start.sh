#!/usr/bin/env bash
# Cloud Agent start — local PostgreSQL, EOS trusted API, Vite app.
# Firebase is not started and is not required.
set -euo pipefail

cd /workspace

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

ensure_postgres() {
  if pg_isready -q -h 127.0.0.1 -p 5432; then
    return 0
  fi
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    local ver
    ver="$(pg_lsclusters --no-header 2>/dev/null | awk 'NR==1 { print $1 }')"
    if [[ -n "${ver:-}" ]]; then
      sudo pg_ctlcluster "$ver" main start || true
    fi
  fi
  sudo service postgresql start || true
  for _ in $(seq 1 30); do
    pg_isready -q -h 127.0.0.1 -p 5432 && return 0
    pg_isready -q && return 0
    sleep 1
  done
  log "postgres did not become ready"
  return 1
}

ensure_role_and_db() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eos') THEN
    CREATE ROLE eos LOGIN PASSWORD 'eos' CREATEDB;
  ELSE
    ALTER ROLE eos WITH LOGIN PASSWORD 'eos' CREATEDB;
  END IF;
END
\$\$;"
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='eos_policy'" | grep -q 1; then
    sudo -u postgres createdb -O eos eos_policy
  fi

  local hba
  hba="$(sudo -u postgres psql -tAc "SHOW hba_file")"
  if [[ -n "$hba" ]] && ! sudo grep -q 'EOS cloud-agent local' "$hba"; then
    printf '\n# EOS cloud-agent local\nhost all eos 127.0.0.1/32 scram-sha-256\nhost all eos ::1/128 scram-sha-256\n' \
      | sudo tee -a "$hba" >/dev/null
    sudo -u postgres psql -c 'SELECT pg_reload_conf();' >/dev/null
  fi
}

write_auth_env() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    return 0
  fi
  ENV_FILE="$env_file" node <<'NODE'
const { generateKeyPairSync, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const out = process.env.ENV_FILE;
const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const signing = generateKeyPairSync("ed25519");
const kid = "nonprod-cloud";
const factorId = "f1";
const vars = {
  EOS_ENVIRONMENT: "nonprod",
  DATABASE_URL: "postgres://eos:eos@127.0.0.1:5432/eos_policy",
  POLICY_TEST_DATABASE_URL: "postgres://eos:eos@127.0.0.1:5432/eos_policy",
  EOS_API_PORT: "8787",
  EOS_ALLOWED_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173",
  EOS_AUTH_VERIFY_KEYS: JSON.stringify({ [kid]: signing.publicKey.export({ format: "jwk" }) }),
  EOS_AUTH_ISSUER: "http://127.0.0.1:8787/auth",
  EOS_AUTH_AUDIENCE: "http://127.0.0.1:8787",
  EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(signing.privateKey.export({ format: "jwk" })),
  EOS_AUTH_SIGNING_KID: kid,
  EOS_HUMAN_LOGIN: "enabled",
  EOS_AUTH_FACTOR_KEYS: JSON.stringify({ [factorId]: randomBytes(32).toString("base64url") }),
  EOS_AUTH_FACTOR_KEY_ID: factorId,
  EOS_AUTH_COOKIE_SAMESITE: "Lax",
  EOS_AUTH_TRUSTED_PROXY_HOPS: "0",
};
const body = Object.entries(vars)
  .map(([name, value]) => `export ${name}=${shQuote(value)}`)
  .join("\n");
fs.writeFileSync(out, `${body}\n`, { mode: 0o600 });
NODE
}

ensure_postgres
ensure_role_and_db

mkdir -p /tmp/cursor
AUTH_ENV=/tmp/cursor/eos-agent.env
write_auth_env "$AUTH_ENV"
set -a
# shellcheck disable=SC1090
source "$AUTH_ENV"
set +a

npm run migrate:up --prefix functions

if ! tmux has-session -t eos-api 2>/dev/null; then
  tmux new-session -d -s eos-api "bash -lc 'set -a; source /tmp/cursor/eos-agent.env; set +a; cd /workspace/functions && exec npm start' 2>&1 | tee /tmp/eos-api.log"
fi

if ! tmux has-session -t vite 2>/dev/null; then
  tmux new-session -d -s vite "bash -lc 'cd /workspace/field-ops-app-vite && VITE_ENVIRONMENT_ID=platform-sandbox VITE_EOS_API_BASE_URL=http://127.0.0.1:8787 VITE_EOS_HUMAN_LOGIN=enabled VITE_BASE=/ exec npm run dev -- --host 0.0.0.0 --port 5173 --strictPort' 2>&1 | tee /tmp/vite.log"
fi

api_ok=0
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8787/health >/dev/null; then
    api_ok=1
    break
  fi
  sleep 1
done
if [[ "$api_ok" -ne 1 ]]; then
  log "EOS API did not become healthy"
  tail -n 80 /tmp/eos-api.log 2>/dev/null || true
  exit 1
fi

vite_ok=0
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:5173 >/dev/null; then
    vite_ok=1
    break
  fi
  sleep 1
done
if [[ "$vite_ok" -ne 1 ]]; then
  log "Vite did not become ready"
  tail -n 80 /tmp/vite.log 2>/dev/null || true
  exit 1
fi

log "EOS API http://127.0.0.1:8787/health and Vite http://127.0.0.1:5173 ready"
exit 0
