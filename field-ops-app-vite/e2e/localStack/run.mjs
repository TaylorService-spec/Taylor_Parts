#!/usr/bin/env node
// LOCAL GOVERNED STACK -- one command: seed (idempotent) -> start API + app -> run the Parts network spec -> stop what it started.
//
//   node e2e/localStack/run.mjs [--no-seed]
//
// TEST INFRASTRUCTURE. Requires: a loopback Postgres (EOS_NET_PG_URL), `npm ci` in functions/ and field-ops-app-vite/,
// `npm run build` in functions/, and a Playwright Chromium. See e2e/README.md. The spec's exit code is this script's.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stackConfig } from "./stackEnv.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const cfg = stackConfig();
const node = (script, args = [], env = {}) => spawnSync(process.execPath, [script, ...args], { cwd: APP, stdio: "inherit", env: { ...process.env, ...env } }).status ?? 1;

let status = process.argv.includes("--no-seed") ? 0 : node(join(HERE, "seedWorld.mjs"));
if (status === 0) {
  try {
    status = node(join(HERE, "stack.mjs"), ["start"]);
    if (status === 0) {
      status = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "-c", "playwright.network.config.mjs"], {
        cwd: APP, stdio: "inherit",
        env: {
          ...process.env,
          EOS_NET_APP_URL: cfg.appOrigin, EOS_NET_API_ORIGIN: cfg.apiOrigin,
          EOS_NET_CREDENTIALS_FILE: cfg.credentialsFile, EOS_NET_WORLD_FILE: existsSync(cfg.worldFile) ? cfg.worldFile : "",
          EOS_NET_EXPECTED_CAPS_FILE: process.env.EOS_NET_EXPECTED_CAPS_FILE ?? "",
        },
      }).status ?? 1;
    }
  } finally {
    node(join(HERE, "stack.mjs"), ["stop"]);
  }
}
process.exit(status);
