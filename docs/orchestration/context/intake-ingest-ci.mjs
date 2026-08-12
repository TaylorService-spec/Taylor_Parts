// Automatic intake ingestion for CI — validates every governed work artifact and emits its deterministic
// status artifact. This is the repo-native automatic-consumption trigger: on a merged/updated intake
// artifact, EOS resolves it (fail-closed on any bad hash — this would have caught an invalid ChatGPT
// submission), projects it into the existing selector, and writes status/<id>.status.json.
//
// It NEVER executes a worker, calls a model, or spends money — it validates + projects + emits status.
// Actually committing the emitted status back to the repo (so a ChatGPT read connector can fetch it) is a
// separate, Owner-enabled step in the workflow (`contents: write`), off by default.
//
// Modes: `--check` (default) validates + emits to a temp report, fails on any invalid artifact or drift
// against the committed status; `--write` writes status/index artifacts into the working tree.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { ingestIntake } from "../lib/intakeIngress.mjs";
import { verifyIntakeStatus } from "../lib/intakeStatus.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const INTAKE_DIR = "docs/orchestration/work-intake";
// A fixed timestamp keeps re-emission deterministic in CI (no wall-clock drift in the committed status);
// the workflow passes the merge commit time when it wants a real timestamp.
const NOW = process.env.EOS_INTAKE_NOW || "2026-01-01T00:00:00Z";

function workArtifacts() {
  const dir = join(REPO, INTAKE_DIR);
  // Repo-relative, forward-slash locations (the artifact's artifactLocation is forward-slash on every OS).
  return readdirSync(dir).filter((f) => f.endsWith(".work.json")).map((f) => `${INTAKE_DIR}/${f}`);
}

function ingestOne(location) {
  const bytes = readFileSync(join(REPO, location));
  const a = JSON.parse(bytes);
  // Use the artifact's own updatedAt as the status timestamp so write-back is DETERMINISTIC and idempotent:
  // the same work artifact always derives byte-identical status (no timestamp churn, no commit noise).
  const r = ingestIntake({ requestId: a.requestId, location, sha256: a.sha256, bytes, now: a.updatedAt || NOW });
  return { requestId: a.requestId, status: r.status, state: r.status.state, mayExecute: r.gate.mayExecute };
}

const BASELINE_STATES = new Set(["STAGED", "READY", "OWNER_REQUIRED"]);

// A work artifact derives only the baseline state. Verified runtime outcomes are durable evidence and
// must not be reset to READY by a later write-back pass. They are preservable only while cryptographically
// bound to the exact current work artifact; tampering and stale bindings still fail closed.
function assessCommittedStatus(committed, derivedStatus) {
  const verification = verifyIntakeStatus(committed);
  if (!verification.ok) return { ok: false, preserve: false, reason: verification.reason };
  const bound = committed.workArtifact?.location === derivedStatus.workArtifact?.location
    && committed.workArtifact?.sha256 === derivedStatus.workArtifact?.sha256;
  if (!bound) return { ok: false, preserve: false, reason: "workArtifact binding does not match the current intake" };
  if (BASELINE_STATES.has(committed.state)) {
    if (committed.state !== derivedStatus.state) {
      return { ok: false, preserve: false, reason: `committed baseline state ${committed.state} != derived ${derivedStatus.state}` };
    }
    return { ok: true, preserve: false, reason: null };
  }
  return { ok: true, preserve: true, reason: null };
}

function main() {
  const write = process.argv.includes("--write");
  const results = [];
  const errors = [];
  for (const location of workArtifacts()) {
    try {
      const r = ingestOne(location);
      results.push(r);
      const committedPath = join(REPO, r.status.artifactLocation);
      const committed = existsSync(committedPath) ? JSON.parse(readFileSync(committedPath, "utf8")) : null;
      const assessment = committed ? assessCommittedStatus(committed, r.status) : null;
      if (write) {
        if (assessment && !assessment.ok && !assessment.reason.startsWith("workArtifact binding")) {
          errors.push(`${r.requestId}: committed status fails verification (${assessment.reason})`);
        } else if (!assessment?.preserve) {
          mkdirSync(dirname(committedPath), { recursive: true });
          writeFileSync(committedPath, `${JSON.stringify(r.status, null, 2)}\n`);
        }
      } else {
        // check mode: a committed status, if present, must verify + match the freshly-derived state
        if (assessment && !assessment.ok) errors.push(`${r.requestId}: committed status fails verification (${assessment.reason})`);
      }
    } catch (e) {
      errors.push(`${location}: ${e.message}`);
    }
  }
  const summary = { mode: write ? "write" : "check", intakeCount: results.length, states: results.map((r) => ({ requestId: r.requestId, state: r.state, mayExecute: r.mayExecute })), errors };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (errors.length) { process.stderr.write(`intake-ingest: ${errors.length} problem(s) — see summary\n`); process.exit(1); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
export { ingestOne, workArtifacts };
export { assessCommittedStatus };
