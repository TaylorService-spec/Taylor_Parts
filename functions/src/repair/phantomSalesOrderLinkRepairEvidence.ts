// X-PHANTOM-SALES-ORDER-LINK-REPAIR -- INERT, PURE sanitized-evidence builders for the phantom Sales Order
// link repair (see phantomSalesOrderLinkRepair.ts). Produce deterministic report objects/strings and a
// secret-scan guard; they perform NO I/O. Mirrors salesOrderNumberBackfillEvidence.ts's shape exactly. The
// operator CLI (functions/scripts/phantomSalesOrderLinkRepairCli.js) writes them atomically and, per
// docs/governance/audit-artifact-standard.md, publishes the execute artifact only after a passing post-write
// verification.

import { createHash } from "node:crypto";
import type { RepairPlan, RepairExecuteResult } from "./phantomSalesOrderLinkRepair.js";

// Mirrors salesOrderNumberBackfillEvidence.ts: refuse to publish anything that looks like a Google API key, a
// JWT, or a labelled secret/PII field. workOrderId/salesOrderId (Firestore document ids) and status/
// inventorySnapshot (governed operational data, not secrets or PII) are all safe to emit.
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
  readonly kind: "phantom-sales-order-link-repair-plan";
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly governedCommit: string;
  readonly generatedAt: string; // ISO-8601 UTC
  readonly phantomSalesOrderId: string;
  readonly repairPackageId: string;
  readonly reason: string;
  readonly counts: RepairPlan["counts"];
  readonly assignments: RepairPlan["assignments"];
  readonly alreadyRepaired: RepairPlan["alreadyRepaired"];
  readonly planHash: string; // hash of the operative (execute-binding) content, excludes generatedAt
}

export function buildPlanEvidence(plan: RepairPlan, ctx: { projectId: string; governedCommit: string; now: () => Date }): PlanEvidence {
  const operative = {
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    phantomSalesOrderId: plan.phantomSalesOrderId,
    repairPackageId: plan.repairPackageId,
    reason: plan.reason,
    assignments: plan.assignments,
    alreadyRepaired: plan.alreadyRepaired,
  };
  return {
    kind: "phantom-sales-order-link-repair-plan",
    schemaVersion: 1,
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    generatedAt: ctx.now().toISOString(),
    phantomSalesOrderId: plan.phantomSalesOrderId,
    repairPackageId: plan.repairPackageId,
    reason: plan.reason,
    counts: plan.counts,
    assignments: plan.assignments,
    alreadyRepaired: plan.alreadyRepaired,
    planHash: sha256(canonicalJson(operative)),
  };
}

export interface ExecutionEvidence {
  readonly kind: "phantom-sales-order-link-repair-execution";
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly governedCommit: string;
  readonly generatedAt: string;
  readonly boundPlanHash: string; // the plan.json this execution was bound to
  readonly counts: RepairExecuteResult["counts"];
  readonly repaired: readonly { readonly workOrderId: string; readonly postRepairUpdateTimeMillis: number }[];
}
export function buildExecutionEvidence(
  result: RepairExecuteResult,
  postRepairUpdateTimes: ReadonlyMap<string, number>,
  ctx: { projectId: string; governedCommit: string; boundPlanHash: string; now: () => Date }
): ExecutionEvidence {
  return {
    kind: "phantom-sales-order-link-repair-execution",
    schemaVersion: 1,
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    generatedAt: ctx.now().toISOString(),
    boundPlanHash: ctx.boundPlanHash,
    counts: result.counts,
    repaired: result.repaired.map((r) => ({
      workOrderId: r.workOrderId,
      // The updateTime read IMMEDIATELY after this repair's write commits -- the exact optimistic-
      // concurrency precondition token rollback binds to (see phantomSalesOrderLinkRepairCli.js's
      // runRollback). A document changed since this repair is refused at rollback, never clobbered.
      postRepairUpdateTimeMillis: postRepairUpdateTimes.get(r.workOrderId) ?? 0,
    })),
  };
}

export interface RollbackEvidence {
  readonly kind: "phantom-sales-order-link-repair-rollback";
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly governedCommit: string;
  readonly generatedAt: string;
  readonly boundExecutionEvidenceSha256: string; // the execution-result.json this rollback was bound to
  readonly rolledBack: readonly { readonly workOrderId: string }[];
  readonly skipped: readonly { readonly workOrderId: string; readonly reason: string }[];
}
export function buildRollbackEvidence(
  args: { rolledBack: readonly string[]; skipped: readonly { workOrderId: string; reason: string }[] },
  ctx: { projectId: string; governedCommit: string; boundExecutionEvidenceSha256: string; now: () => Date }
): RollbackEvidence {
  return {
    kind: "phantom-sales-order-link-repair-rollback",
    schemaVersion: 1,
    projectId: ctx.projectId,
    governedCommit: ctx.governedCommit,
    generatedAt: ctx.now().toISOString(),
    boundExecutionEvidenceSha256: ctx.boundExecutionEvidenceSha256,
    rolledBack: args.rolledBack.map((workOrderId) => ({ workOrderId })),
    skipped: args.skipped,
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
