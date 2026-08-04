// Receiving Location Authority -- I-LA3: INERT, PURE sanitized-evidence builders for the warehouse-
// governance migration + verifier (spec §4). Produce deterministic report objects/strings and a
// secret-scan guard; they perform NO I/O. The operator CLI writes them atomically and, per contract,
// publishes only after a passing verification (no report directory on failure). Dry-run evidence lists the
// ambiguous ids + fingerprints the Owner must resolve; verifier evidence is counts + hashes only.

import { createHash } from "node:crypto";
import type { MigrationPlan } from "./warehouseGovernanceMigration.js";
import type { WarehouseGovernanceVerification } from "./warehouseGovernanceVerifier.js";

// Mirrors functions/scripts/firestoreDeploymentVerificationShared.js: refuse to publish anything that
// looks like a Google API key, a JWT, or a labelled secret/PII field.
const SECRET_PATTERN = /(AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|password|refreshToken|idToken|secret|token|email)/i;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export interface DryRunEvidence {
  readonly kind: "warehouse-migration-dry-run";
  readonly projectId: string;
  readonly governedCommit: string;
  readonly counts: MigrationPlan["counts"];
  readonly ambiguous: readonly { readonly warehouseId: string; readonly fingerprint: string }[];
  readonly planHash: string;
}
export function buildDryRunEvidence(plan: MigrationPlan): DryRunEvidence {
  const ambiguous = plan.ambiguous.map((a) => ({ warehouseId: a.warehouseId, fingerprint: a.fingerprint }));
  const planHash = sha256(canonicalJson({ projectId: plan.projectId, governedCommit: plan.governedCommit, classified: plan.classified.map((c) => ({ warehouseId: c.warehouseId, category: c.category, derivedStatus: c.derivedStatus, fingerprint: c.fingerprint })) }));
  return { kind: "warehouse-migration-dry-run", projectId: plan.projectId, governedCommit: plan.governedCommit, counts: plan.counts, ambiguous, planHash };
}

export interface VerifierEvidence {
  readonly kind: "warehouse-governance-verification";
  readonly pass: boolean;
  readonly total: number;
  readonly counts: WarehouseGovernanceVerification["counts"];
  readonly fingerprints: WarehouseGovernanceVerification["fingerprints"];
}
export function buildVerifierEvidence(result: WarehouseGovernanceVerification): VerifierEvidence {
  return { kind: "warehouse-governance-verification", pass: result.pass, total: result.total, counts: result.counts, fingerprints: result.fingerprints };
}

// Deterministic canonical serialization -- stable bytes for checksums + reproducibility.
export function serializeEvidence(evidence: unknown): string { return canonicalJson(evidence); }
export function evidenceSha256(evidence: unknown): string { return sha256(serializeEvidence(evidence)); }

// Guard: return every secret-like match found in the text. A non-empty result MUST block publication.
export function scanForSecrets(text: string): readonly string[] {
  const matches: string[] = [];
  const re = new RegExp(SECRET_PATTERN, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) matches.push(m[0]);
  return matches;
}
