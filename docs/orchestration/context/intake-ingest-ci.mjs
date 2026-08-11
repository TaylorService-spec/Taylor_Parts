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
  const r = ingestIntake({ requestId: a.requestId, location, sha256: a.sha256, bytes, now: NOW });
  return { requestId: a.requestId, status: r.status, state: r.status.state, mayExecute: r.gate.mayExecute };
}

function main() {
  const write = process.argv.includes("--write");
  const results = [];
  const errors = [];
  for (const location of workArtifacts()) {
    try {
      const r = ingestOne(location);
      results.push(r);
      if (write) {
        const statusPath = join(REPO, r.status.artifactLocation);
        mkdirSync(dirname(statusPath), { recursive: true });
        writeFileSync(statusPath, `${JSON.stringify(r.status, null, 2)}\n`);
      } else {
        // check mode: a committed status, if present, must verify + match the freshly-derived state
        const committedPath = join(REPO, r.status.artifactLocation);
        if (existsSync(committedPath)) {
          const committed = JSON.parse(readFileSync(committedPath, "utf8"));
          const v = verifyIntakeStatus(committed);
          if (!v.ok) errors.push(`${r.requestId}: committed status fails verification (${v.reason})`);
          else if (committed.state !== r.state) errors.push(`${r.requestId}: committed status state ${committed.state} != derived ${r.state}`);
        }
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
