#!/usr/bin/env node
// LOCAL GOVERNED STACK -- build / start / stop / status for the EOS API and the app. TEST INFRASTRUCTURE ONLY.
//
//   node e2e/localStack/stack.mjs build|start|stop|status
//
// The app is served from a PRODUCTION BUILD (vite build + vite preview), as deployed, not from the dev server: the dev
// server runs React StrictMode's double effect, which defeats the one-shot cookie session restore in AuthContext on every
// reload and would make direct page loads look signed out. Set EOS_NET_SERVE=dev to serve the dev server anyway.
//
// Starts exactly two processes, both recorded by PID in EOS_NET_STATE_DIR/stack-pids.local.json, and stops exactly those
// PIDs (never by name or pattern -- other lanes share this machine). The API needs functions/lib (`npm run build` in
// functions/) and the migrated, seeded database (`node e2e/localStack/seedWorld.mjs`).
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, apiEnv, FUNCTIONS_DIR, stackConfig, viteEnv } from "./stackEnv.mjs";

const cfg = stackConfig();
const [command = "status"] = process.argv.slice(2);
const VITE = "node_modules/vite/bin/vite.js";
const distDir = join(cfg.stateDir, "app-dist");
const serveDev = process.env.EOS_NET_SERVE === "dev";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitFor(url, label, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`${label} did not become ready at ${url} within ${ms / 1000}s`);
}
const readPids = () => (existsSync(cfg.pidFile) ? JSON.parse(readFileSync(cfg.pidFile, "utf8")) : {});

function launch(name, script, args, cwd, env) {
  const out = openSync(join(cfg.stateDir, `${name}.log`), "w");
  const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["ignore", out, out], windowsHide: true, detached: true });
  child.unref();
  closeSync(out);
  return child.pid;
}

function build() {
  const r = spawnSync(process.execPath, [VITE, "build", "--outDir", distDir, "--emptyOutDir"], { cwd: APP_DIR, env: viteEnv(cfg), stdio: "inherit" });
  if (r.status !== 0) { console.error("vite build failed"); process.exit(r.status ?? 1); }
}

if (command === "build") {
  build();
} else if (command === "start") {
  const pids = readPids();
  if (Object.values(pids).some((p) => alive(p))) { console.error("REFUSED: a recorded stack process is still running; stop it first"); process.exit(2); }
  if (!serveDev && (process.argv.includes("--rebuild") || !existsSync(join(distDir, "index.html")))) build();
  const apiPid = launch("api", "scripts/serveEosApi.mjs", [], FUNCTIONS_DIR, apiEnv(cfg));
  const appArgs = serveDev
    ? ["--host", "127.0.0.1", "--port", String(cfg.vitePort), "--strictPort"]
    : ["preview", "--outDir", distDir, "--host", "127.0.0.1", "--port", String(cfg.vitePort), "--strictPort"];
  const vitePid = launch("app", VITE, appArgs, APP_DIR, viteEnv(cfg));
  writeFileSync(cfg.pidFile, JSON.stringify({ api: apiPid, app: vitePid }));
  await waitFor(`${cfg.apiOrigin}/health`, "EOS API");
  await waitFor(cfg.appOrigin, "app");
  console.log(`stack up: API ${cfg.apiOrigin} (pid ${apiPid}), app ${cfg.appOrigin} (pid ${vitePid}, ${serveDev ? "dev server" : "production build"})`);
} else if (command === "stop") {
  const pids = readPids();
  for (const [name, pid] of Object.entries(pids)) {
    if (alive(pid)) { try { process.kill(pid); console.log(`stopped ${name} pid ${pid}`); } catch (e) { console.error(`could not stop ${name} pid ${pid}: ${e.message}`); } }
  }
  try { unlinkSync(cfg.pidFile); } catch { /* none */ }
} else {
  const pids = readPids();
  console.log(JSON.stringify(Object.fromEntries(Object.entries(pids).map(([n, p]) => [n, { pid: p, alive: alive(p) }]))));
}
