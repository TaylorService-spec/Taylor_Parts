// X-SALES-ORDER-NUMBER-BACKFILL -- INERT, PURE sanitized-evidence builders for the Sales Order number
// backfill (see salesOrderNumberBackfill.ts). Produce deterministic report objects/strings and a secret-scan
// guard; they perform NO I/O. The operator CLI (functions/scripts/salesOrderNumberBackfillCli.js) writes them
// atomically and, per docs/governance/audit-artifact-standard.md, publishes the execute artifact only after a
// passing post-write verification.

import { createHash } from "node:crypto";
import type { BackfillPlan, BackfillExecuteResult } from "./salesOrderNumberBackfill.js";

// Mirrors warehouseGovernanceEvidence.ts / firestoreDeploymentVerificationShared.js: refuse to publish
// anything that looks like a Google API key, a JWT, or a labelled secret/PII field. salesOrderId (a Firestore
// document id) and salesOrderNumber (a governed reference string) are neither -- both are safe to emit.
const SECRET_PATTERN = /(AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|password|refreshToken|idToken|secret|client_secret)/i;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface PlanEvidence {
  readonly kind: "sales-order-number-backfill-plan";
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly governedCommit: string;
  readonly generatedAt: string; // ISO-8601 UTC
  readonly counts: BackfillPlan["counts"];
  readonly assignments: BackfillPlan["assignments"];
  readonly collisions: BackfillPlan["collisions"];
  readonly blocked: BackfillPlan["blocked"];
  readonly counterSnapshot: BackfillPlan["counterSnapshot"];
  readonly planHash: string; // hash of the operative (execute-binding) content, excludes generatedAt
}

// The plan.json artifact IS the execute-binding input (analogous to warehouseGovernanceMigrationCli's
// Owner-authored manifest, except this plan is produced by the deterministic tool itself, not hand-authored --
// it is still content-hash-pinned before execute will accept it).
export function buildPlanEvidence(plan: BackfillPlan, ctx: { projectId: string; governedCommit: string; now: () => Date }): PlanEvidence {
  const operative = {
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    assignments: plan.assignments,
    collisions: plan.collisions,
    blocked: plan.blocked,
    counterSnapshot: plan.counterSnapshot,
  };
  return {
    kind: "sales-order-number-backfill-plan",
    schemaVersion: 1,
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    generatedAt: ctx.now().toISOString(),
    counts: plan.counts,
    assignments: plan.assignments,
    collisions: plan.collisions,
    blocked: plan.blocked,
    counterSnapshot: plan.counterSnapshot,
    planHash: sha256(canonicalJson(operative)),
  };
}

export interface ExecutionEvidence {
  readonly kind: "sales-order-number-backfill-execution";
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly governedCommit: string;
  readonly generatedAt: string;
  readonly boundPlanHash: string; // the plan.json this execution was bound to
  readonly counts: BackfillExecuteResult["counts"];
  readonly assigned: BackfillExecuteResult["assigned"];
}
export function buildExecutionEvidence(
  result: BackfillExecuteResult,
  ctx: { projectId: string; governedCommit: string; boundPlanHash: string; now: () => Date }
): ExecutionEvidence {
  return {
    kind: "sales-order-number-backfill-execution",
    schemaVersion: 1,
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    generatedAt: ctx.now().toISOString(),
    boundPlanHash: ctx.boundPlanHash,
    counts: result.counts,
    assigned: result.assigned,
  };
}

// Deterministic canonical serialization -- stable bytes for checksums + reproducibility.
export function serializeEvidence(evidence: unknown): string {
  return JSON.stringify(evidence, null, 2) + "\n";
}

// Guard: return every secret-like match found in the text. A non-empty result MUST block publication.
export function scanForSecrets(text: string): readonly string[] {
  const matches: string[] = [];
  const re = new RegExp(SECRET_PATTERN, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) matches.push(m[0]);
  return matches;
}
