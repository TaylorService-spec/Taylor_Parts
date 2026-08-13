// Gateway Verifier CI entrypoint (#820) — runs `preflightSubmission` against the raw GitHub Issue
// event BEFORE the existing `eos-issue-intake` adapter builds a work.json artifact. PASS lets the
// workflow continue unchanged; REJECT_CORRECTABLE or ESCALATE fails closed and comments the
// structured outcome on the Issue rather than silently proceeding to `eos-intake`.
//
// `--attempt <n>` lets the workflow track correction attempts per Issue (e.g. via a label counter
// or a small state file it owns); this script stays pure I/O-at-the-edges and does no counting
// itself.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { preflightSubmission } from "../lib/gatewayVerifier.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function main() {
  const eventArg = process.argv.indexOf("--event");
  if (eventArg < 0 || !process.argv[eventArg + 1]) throw new Error("--event <path> is required");
  const event = JSON.parse(readFileSync(resolve(process.argv[eventArg + 1]), "utf8"));

  const repoArg = process.argv.indexOf("--repo");
  const expectedRepoFullName = repoArg >= 0 ? process.argv[repoArg + 1] : (event?.repository?.full_name || null);

  const attemptArg = process.argv.indexOf("--attempt");
  const attempt = attemptArg >= 0 ? Number(process.argv[attemptArg + 1]) || 0 : 0;

  const requestId = `EOS-ISSUE-${event?.issue?.number}`;
  const existingWorkArtifact = existsSync(join(REPO, `docs/orchestration/work-intake/${requestId}.work.json`));

  const outcome = preflightSubmission(event, { expectedRepoFullName, existingWorkArtifact, attempt });
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
  if (outcome.outcome !== "PASS") {
    process.stderr.write(`gateway-preflight: ${outcome.outcome} — ${outcome.reason}\n`);
    process.exit(1);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main();
