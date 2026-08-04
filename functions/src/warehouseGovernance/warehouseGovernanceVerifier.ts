// Receiving Location Authority -- I-LA3: INERT, READ-ONLY warehouse-governance verifier (spec §4). PURE
// and DETERMINISTIC: given the live warehouse set (each bound to its Firestore document id), it categorizes
// every record using the merged shared §3A validator and reports SANITIZED counts + per-category hashes
// only -- never a raw unexpected field, credential, token, actor PII, or secret. A governed record must
// carry no legacy `active` and must have its stored id equal to its document id (both enforced by the
// shared validator). The verifier NEVER writes; the operator CLI publishes evidence atomically only after
// every check passes (no report directory on failure).

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { validateGovernedWarehouse } from "./governedWarehouseValidation.js";
import { classifyWarehouse } from "./warehouseGovernanceMigration.js";

function canonicalJson(value: unknown): string {
  if (value instanceof Timestamp) return `T:${value.toMillis()}`;
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function isPlainObject(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function hasOwn(o: Record<string, unknown>, k: string): boolean { return Object.prototype.hasOwnProperty.call(o, k); }
// Hash of a category's sorted id set -- proves membership without exposing raw records.
function idSetHash(ids: readonly string[]): string { return sha256(canonicalJson([...ids].sort())); }

export type VerifierCategory = "governed" | "legacy" | "ambiguous" | "malformed";
export interface WarehouseGovernanceVerification {
  readonly total: number;
  readonly pass: boolean; // true iff every record is a governed §3A record (and none flagged)
  readonly counts: Readonly<Record<VerifierCategory, number>> & { readonly activePresent: number; readonly identityMismatch: number };
  readonly fingerprints: {
    readonly legacy: string;
    readonly ambiguous: string;
    readonly malformed: string;
    readonly activePresent: string;
    readonly identityMismatch: string;
  };
}

export interface VerifierRecord { readonly warehouseId: string; readonly data: unknown; }

export function verifyWarehouseGovernance(records: readonly VerifierRecord[]): WarehouseGovernanceVerification {
  const cat: Record<VerifierCategory, string[]> = { governed: [], legacy: [], ambiguous: [], malformed: [] };
  const activePresent: string[] = [];
  const identityMismatch: string[] = [];

  for (const r of records) {
    const id = r.warehouseId;
    // Independent structural flags (a record may be flagged AND non-governed).
    if (isPlainObject(r.data) && hasOwn(r.data, "active")) activePresent.push(id);
    if (isPlainObject(r.data) && typeof r.data.id === "string" && r.data.id !== id) identityMismatch.push(id);

    if (validateGovernedWarehouse(r.data, id).valid) { cat.governed.push(id); continue; }
    if (!isPlainObject(r.data)) { cat.malformed.push(id); continue; }
    const c = classifyWarehouse(id, r.data);
    if (c.category === "DERIVE") cat.legacy.push(id);
    else cat.ambiguous.push(id); // AMBIGUOUS (contradiction / malformed status)
  }

  const total = records.length;
  const pass = cat.governed.length === total && activePresent.length === 0 && identityMismatch.length === 0;
  return {
    total,
    pass,
    counts: {
      governed: cat.governed.length,
      legacy: cat.legacy.length,
      ambiguous: cat.ambiguous.length,
      malformed: cat.malformed.length,
      activePresent: activePresent.length,
      identityMismatch: identityMismatch.length,
    },
    fingerprints: {
      legacy: idSetHash(cat.legacy),
      ambiguous: idSetHash(cat.ambiguous),
      malformed: idSetHash(cat.malformed),
      activePresent: idSetHash(activePresent),
      identityMismatch: idSetHash(identityMismatch),
    },
  };
}
