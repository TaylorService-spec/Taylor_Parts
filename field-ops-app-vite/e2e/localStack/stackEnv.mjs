// LOCAL GOVERNED STACK -- configuration. TEST INFRASTRUCTURE ONLY.
//
// Generates (once) and re-reads the local-only keys the EOS API needs: the ed25519 access-token signing key and the
// factor keyring that seals every TOTP secret. They are LOCAL TEST VALUES, written to a file OUTSIDE the repository
// (EOS_NET_STATE_DIR) with mode 0600 and never printed. The factor keyring must stay constant between runs: the
// enrolled authenticator secrets are sealed under it, so regenerating it would strand every enrolled login.
//
// Nothing here can point at nonprod or production: the database URL is required to be a loopback host.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(HERE, "..", "..");
export const REPO_ROOT = resolve(APP_DIR, "..");
export const FUNCTIONS_DIR = join(REPO_ROOT, "functions");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function stackConfig(env = process.env) {
  const stateDir = resolve(env.EOS_NET_STATE_DIR ?? join(homedir(), ".eos-net-state"));
  const apiPort = Number(env.EOS_NET_API_PORT ?? 8791);
  const vitePort = Number(env.EOS_NET_VITE_PORT ?? 5191);
  const pgBase = env.EOS_NET_PG_URL ?? "postgres://eos@127.0.0.1:55499";
  const database = env.EOS_NET_DB_NAME ?? "pra_browser_1";
  const pgUrl = new URL(pgBase);
  if (!LOOPBACK.has(pgUrl.hostname)) {
    throw new Error(`REFUSED: EOS_NET_PG_URL host '${pgUrl.hostname}' is not loopback. The local stack never touches a remote database.`);
  }
  const adminUrl = new URL(pgUrl); adminUrl.pathname = "/postgres";
  const dbUrl = new URL(pgUrl); dbUrl.pathname = `/${database}`;
  return {
    stateDir, apiPort, vitePort, database,
    adminDatabaseUrl: adminUrl.toString(), databaseUrl: dbUrl.toString(),
    apiOrigin: `http://127.0.0.1:${apiPort}`, appOrigin: `http://127.0.0.1:${vitePort}`,
    tenantKey: "taylor-nonprod",
    credentialsFile: join(stateDir, "persona-login.credentials.local.json"),
    worldFile: join(stateDir, "world.local.json"),
    keysFile: join(stateDir, "stack-keys.local.json"),
    pidFile: join(stateDir, "stack-pids.local.json"),
  };
}

function loadOrCreateKeys(cfg) {
  mkdirSync(cfg.stateDir, { recursive: true });
  if (existsSync(cfg.keysFile)) return JSON.parse(readFileSync(cfg.keysFile, "utf8"));
  const signing = generateKeyPairSync("ed25519");
  const kid = "nonprod-local-browser-net";
  const factorId = "f1";
  const keys = {
    kid, factorId,
    verifyKeys: { [kid]: signing.publicKey.export({ format: "jwk" }) },
    signingKey: signing.privateKey.export({ format: "jwk" }),
    factorKeys: { [factorId]: randomBytes(32).toString("base64url") },
  };
  writeFileSync(cfg.keysFile, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(cfg.keysFile, 0o600); } catch { /* best effort on Windows */ }
  return keys;
}

/** The environment the API (and every seeding script) runs under. Mirrors .cursor/start.sh. */
export function apiEnv(cfg, base = process.env) {
  const k = loadOrCreateKeys(cfg);
  return {
    ...base,
    EOS_ENVIRONMENT: "nonprod",
    DATABASE_URL: cfg.databaseUrl,
    POLICY_TEST_DATABASE_URL: cfg.databaseUrl,
    EOS_API_PORT: String(cfg.apiPort),
    EOS_ALLOWED_ORIGINS: `${cfg.appOrigin},http://localhost:${cfg.vitePort}`,
    EOS_AUTH_VERIFY_KEYS: JSON.stringify(k.verifyKeys),
    EOS_AUTH_ISSUER: `${cfg.apiOrigin}/auth`,
    EOS_AUTH_AUDIENCE: cfg.apiOrigin,
    EOS_AUTH_SIGNING_KEY_NONPROD: JSON.stringify(k.signingKey),
    EOS_AUTH_SIGNING_KID: k.kid,
    EOS_HUMAN_LOGIN: "enabled",
    EOS_AUTH_FACTOR_KEYS: JSON.stringify(k.factorKeys),
    EOS_AUTH_FACTOR_KEY_ID: k.factorId,
    EOS_AUTH_COOKIE_SAMESITE: "Lax",
    EOS_AUTH_TRUSTED_PROXY_HOPS: "0",
  };
}

export function viteEnv(cfg, base = process.env) {
  return {
    ...base,
    VITE_ENVIRONMENT_ID: "platform-sandbox",
    VITE_EOS_API_BASE_URL: cfg.apiOrigin,
    VITE_EOS_HUMAN_LOGIN: "enabled",
    VITE_BASE: "/",
  };
}
