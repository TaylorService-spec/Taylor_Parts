// Issue #219 -- worktree-anchored Firestore+Auth emulator launcher.
//
//   node .claude/skills/run-field-ops-app-vite/emulator.mjs start
//   node .claude/skills/run-field-ops-app-vite/emulator.mjs stop
//
// `start` resolves the tested worktree from THIS skill's own location (never the
// caller's cwd), runs a fail-closed preflight (config exists, Rules target
// exists, root and Vite Rules byte-identical), prints the provenance (worktree
// HEAD, config path, Rules path, Rules sha256), then launches Firebase with an
// explicit absolute `--config <worktree>/firebase.json --project taylor-parts`.
// Readiness is a BOUNDED poll (no background poller). The exact PID(s) it owns are
// recorded so `stop` can tear down only those -- never a broad command-line match.
//
// Run this via the agent's background-process mechanism: `start` stays alive
// holding the emulator child; `stop` (a separate short-lived invocation) reads the
// recorded PIDs and kills only them.

import { spawn } from "node:child_process";
import { openSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  SKILL_DIR,
  EMULATOR_PROJECT,
  resolveProvenance,
  formatProvenance,
  ownedPidsPath,
  stopOwnedPids,
  EmulatorProvenanceError,
} from "./emulatorProvenance.mjs";

const LOG_PATH = join(SKILL_DIR, ".emulator.log");

function emulatorPorts(configPath) {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const e = cfg.emulators || {};
    return {
      firestore: (e.firestore && e.firestore.port) || 8080,
      auth: (e.auth && e.auth.port) || 9099,
      functions: (e.functions && e.functions.port) || 5001,
    };
  } catch {
    return { firestore: 8080, auth: 9099, functions: 5001 };
  }
}

async function portResponds(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}`, { method: "GET" });
    return res.status >= 200 && res.status < 600; // any HTTP answer means it's up
  } catch {
    return false;
  }
}

// Bounded readiness -- a finite number of attempts, then give up. NOT a
// background poller: it runs inside `start` and either resolves or the command
// fails closed.
async function waitForReady(ports, needFunctions, { attempts = 90, delayMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const core = (await portResponds(ports.firestore)) && (await portResponds(ports.auth));
    const fns = !needFunctions || (await portResponds(ports.functions || 5001));
    if (core && fns) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function start() {
  // Optional first arg selects the emulators to run (default firestore,auth).
  // Issue #214 PR-3 needs the Cloud Functions emulator for Work Order transitions:
  //   node emulator.mjs start functions,firestore,auth
  // Provenance/anchoring are unchanged -- only the `--only` list differs.
  const onlyArg = process.argv[3];
  const only = onlyArg && /^[a-z,]+$/.test(onlyArg) ? onlyArg : "firestore,auth";
  const needFunctions = only.split(",").includes("functions");
  // Preflight FIRST -- any ambiguity fails closed before anything is spawned.
  let prov;
  try {
    prov = resolveProvenance();
  } catch (err) {
    if (err instanceof EmulatorProvenanceError) {
      console.error(`FAIL-CLOSED: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  console.log(formatProvenance(prov));

  const ports = emulatorPorts(prov.configPath);
  const out = openSync(LOG_PATH, "a");
  // shell:true so the `firebase` CLI shim resolves on Windows/PATH; the child's
  // PID roots the tree we own and later tear down by exact PID.
  const child = spawn(
    "firebase",
    [
      "emulators:start",
      "--only",
      only,
      "--project",
      EMULATOR_PROJECT,
      "--config",
      prov.configPath,
    ],
    { stdio: ["ignore", out, out], shell: true, windowsHide: true }
  );

  writeFileSync(
    ownedPidsPath(),
    JSON.stringify(
      { pids: [child.pid], startedAt: new Date().toISOString(), provenance: prov, log: LOG_PATH },
      null,
      2
    )
  );

  // If the emulator process exits on its own, surface it and clean the pid file.
  child.on("exit", (code) => {
    try {
      rmSync(ownedPidsPath(), { force: true });
    } catch {
      /* ignore */
    }
    console.error(`emulator process exited (code ${code}). See ${LOG_PATH}`);
    process.exit(code == null ? 1 : code);
  });

  const ready = await waitForReady(ports, needFunctions);
  if (!ready) {
    console.error(
      `FAIL-CLOSED: emulator did not become ready on ports ${ports.firestore}/${ports.auth} within the bound. See ${LOG_PATH}`
    );
    stopOwnedPids([child.pid]);
    try {
      rmSync(ownedPidsPath(), { force: true });
    } catch {
      /* ignore */
    }
    process.exit(1);
  }

  console.log(
    `EMULATOR READY pid=${child.pid} only=${only} firestore=${ports.firestore} auth=${ports.auth}${needFunctions ? ` functions=${ports.functions || 5001}` : ""} rulesSha=sha256:${prov.rulesHash}`
  );
  // Intentionally stay alive holding the child so the agent can run this in the
  // background; `stop` (or killing this owned PID) tears it down.
}

function stop() {
  const pidFile = ownedPidsPath();
  if (!existsSync(pidFile)) {
    console.log("no owned emulator recorded (nothing to stop)");
    return;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(pidFile, "utf8"));
  } catch (err) {
    console.error(`could not read ${pidFile}: ${err.message}`);
    process.exit(1);
  }
  const pids = Array.isArray(record.pids) ? record.pids : [];
  const results = stopOwnedPids(pids);
  for (const r of results) {
    console.log(r.stopped ? `stopped owned pid ${r.pid}` : `pid ${r.pid} not stopped: ${r.error}`);
  }
  try {
    rmSync(pidFile, { force: true });
  } catch {
    /* ignore */
  }
}

const command = process.argv[2];
if (command === "start") {
  start();
} else if (command === "stop") {
  stop();
} else {
  console.error("usage: node emulator.mjs <start|stop>");
  process.exit(2);
}
