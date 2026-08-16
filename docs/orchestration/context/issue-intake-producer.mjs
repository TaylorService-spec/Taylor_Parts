// GitHub Issue -> governed EOS intake producer.
//
// GitHub label acceptance creates EOS_READY/REPO_SAFE work. A separate governed promotion,
// available only after the same event passes the adapter and EOS contract checks, records
// EXECUTION_AUTHORIZED/AUTHORIZED for the existing guarded runtime.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { intakeDigest, resolveWorkIntake } from "../lib/workIntake.mjs";
import { classifyIssueTaskClass, authorizedProfileFromLabels } from "../lib/issueTaskClassifier.mjs";

export const INTAKE_LABEL = "eos-intake";
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const REQUIRED_SECTIONS = ["Purpose", "Scope", "Required work", "Completion"];

function section(body, heading) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return "";
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

export function validateIssueEvent(event) {
  const errors = [];
  const issue = event?.issue;
  if (event?.action !== "labeled") errors.push("event action must be labeled");
  if (event?.label?.name !== INTAKE_LABEL) errors.push(`label must be ${INTAKE_LABEL}`);
  if (!issue || issue.pull_request) errors.push("event must contain a GitHub Issue, not a pull request");
  if (issue?.state !== "open") errors.push("issue must be open");
  if (!Number.isSafeInteger(issue?.number) || issue.number < 1) errors.push("issue number is required");
  if (!TRUSTED_ASSOCIATIONS.has(issue?.author_association)) {
    errors.push("issue author must be an OWNER, MEMBER, or COLLABORATOR");
  }
  if (!event?.repository?.owner?.login || event?.sender?.login !== event.repository.owner.login) {
    errors.push("the repository Owner must apply the eos-intake label");
  }
  if (!issue?.title?.trim()) errors.push("issue title is required");
  if (!issue?.body?.trim()) errors.push("issue body is required");
  for (const heading of REQUIRED_SECTIONS) {
    if (!section(issue?.body || "", heading)) errors.push(`issue body requires a non-empty ## ${heading} section`);
  }
  if (!issue?.html_url) errors.push("issue URL is required");
  if (!issue?.updated_at) errors.push("issue updated_at is required");
  return errors;
}

function issueScope(body) {
  return section(body, "Scope").split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

export function buildIssueIntake(event) {
  const errors = validateIssueEvent(event);
  if (errors.length) throw new Error(`issue intake rejected: ${errors.join("; ")}`);

  const issue = event.issue;
  const requestId = `EOS-ISSUE-${issue.number}`;
  const artifactLocation = `docs/orchestration/work-intake/${requestId}.work.json`;
  const purpose = section(issue.body, "Purpose");
  const scope = issueScope(issue.body);
  const requiredWork = section(issue.body, "Required work");
  const completion = section(issue.body, "Completion");
  // Deterministically classify the REQUESTED execution contract from the issue text/labels (a request, never a
  // grant — the governed profile grant is set separately in authorizeIssueIntake). Fail-closed to
  // READ_ONLY_ANALYSIS; GOVERNED_INTEGRATION is never inferred. Closes the #840 gap where NO contract was set.
  const execution = classifyIssueTaskClass({
    title: issue.title,
    body: `${issue.title}\n${issue.body}`,
    labels: issue.labels || [],
  });
  const artifact = {
    requestId,
    title: issue.title.trim(),
    intent: `${purpose}\n\nRequired work:\n${requiredWork}\n\nCompletion:\n${completion}`,
    scope,
    execution,
    contextScope: ["orchestration", "github-issue-intake"],
    source: {
      producer: "GitHub Issue intake workflow",
      provenance: `Authenticated GitHub ${issue.author_association.toLowerCase()} issue labeled ${INTAKE_LABEL}`,
      sourceRef: issue.html_url,
      githubActor: event.sender?.login || issue.user?.login || null,
    },
    status: "EOS_READY",
    authority: {
      authorizationState: "REPO_SAFE",
      basis: "GitHub accepted the eos-intake label event; EOS validation and execution authorization remain pending.",
      protectedBoundary: null,
    },
    artifactLocation,
    sha256: "",
    createdAt: issue.created_at || issue.updated_at,
    updatedAt: issue.updated_at,
    relatedRefs: { issues: [issue.html_url], pullRequests: [] },
  };
  artifact.sha256 = intakeDigest(artifact);
  resolveWorkIntake({ requestId, location: artifactLocation, sha256: artifact.sha256, bytes: JSON.stringify(artifact) });
  return Object.freeze(artifact);
}

export function authorizeIssueIntake(staged, event) {
  const errors = validateIssueEvent(event);
  if (errors.length) throw new Error(`EOS authorization rejected: ${errors.join("; ")}`);
  if (staged.status !== "EOS_READY" || staged.authority?.authorizationState !== "REPO_SAFE") {
    throw new Error("EOS authorization requires a validated EOS_READY/REPO_SAFE adapter artifact");
  }
  // GOVERNED profile grant — the SEPARATE authority key (PR #839 two-key model). It is derived ONLY from an
  // explicit Owner-applied `eos-authorize-*` label, NEVER from the issue text or the requested task class.
  // Default is the least-privilege READ_ONLY_ANALYSIS: without an explicit grant, an implementation request
  // runs read-only and the completion gate fails closed (never COMPLETE) — the #840 fix.
  const authorizedExecutionProfile = authorizedProfileFromLabels(event.issue.labels || []);
  const promoted = {
    ...staged,
    status: "EXECUTION_AUTHORIZED",
    authority: {
      authorizationState: "AUTHORIZED",
      basis: "EOS accepted the validated, Owner-submitted, explicitly scoped Issue under the issue-intake policy.",
      authorizedBy: event.sender.login,
      authorizedAt: event.issue.updated_at,
      authorizedExecutionProfile,
      protectedBoundary: null,
    },
    sha256: "",
  };
  promoted.sha256 = intakeDigest(promoted);
  resolveWorkIntake({ requestId: promoted.requestId, location: promoted.artifactLocation, sha256: promoted.sha256, bytes: JSON.stringify(promoted) });
  return Object.freeze(promoted);
}

export function serializeIssueIntake(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function main() {
  const eventArg = process.argv.indexOf("--event");
  const outputArg = process.argv.indexOf("--output");
  if (eventArg < 0 || !process.argv[eventArg + 1]) throw new Error("--event <path> is required");
  if (outputArg < 0 || !process.argv[outputArg + 1]) throw new Error("--output <path> is required");
  const event = JSON.parse(readFileSync(resolve(process.argv[eventArg + 1]), "utf8"));
  const staged = buildIssueIntake(event);
  const artifact = process.argv.includes("--authorize") ? authorizeIssueIntake(staged, event) : staged;
  const output = resolve(process.argv[outputArg + 1]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, serializeIssueIntake(artifact));
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, [
      `request_id=${artifact.requestId}`,
      `artifact_location=${artifact.artifactLocation}`,
      `sha256=${artifact.sha256}`,
      `issue_number=${artifact.relatedRefs.issues[0].split("/").at(-1)}`,
    ].join("\n") + "\n", { flag: "a" });
  }
  process.stdout.write(`${JSON.stringify({ requestId: artifact.requestId, artifactLocation: artifact.artifactLocation, sha256: artifact.sha256 })}\n`);
}

// A rejected intake is a FIXABLE authoring problem, not a crash. Round 1 surfaced it as a raw
// Node stack trace wrapped in a PowerShell exception, which reads as a broken system rather than
// a missing heading -- three runs failed this way on 2026-08-13 and nobody could tell why at a
// glance. Lead with what is wrong and how to fix it; keep the stack for genuine defects.
function reportAndExit(err) {
  const msg = String(err?.message || err);
  const rejected = msg.startsWith("issue intake rejected:");
  const lines = ["", "================ EOS INTAKE REJECTED ================", ""];
  if (rejected) {
    for (const reason of msg.replace("issue intake rejected: ", "").split("; ")) {
      lines.push(`  - ${reason}`);
    }
    lines.push(
      "",
      "  The issue body must contain ALL of these headings, each non-empty:",
      "    ## Purpose        why this work exists",
      "    ## Scope          what is in bounds (one bullet per item)",
      "    ## Required work  what must actually be done",
      "    ## Completion     what PROVES it is done",
      "",
      "  Use the template at .github/ISSUE_TEMPLATE/eos-intake.md.",
      "  Fix the issue body, then re-apply the eos-intake label. Nothing else needs to change.",
    );
  } else {
    lines.push(`  ${msg}`, "", "  This is not an authoring problem -- see the stack below.");
  }
  lines.push("", "=====================================================", "");
  process.stderr.write(lines.join("\n"));
  if (!rejected && err?.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (err) { reportAndExit(err); }
}
