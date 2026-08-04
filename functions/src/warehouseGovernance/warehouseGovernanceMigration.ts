// Receiving Location Authority -- I-LA3: INERT, UNEXPORTED warehouse-governance migration core
// (spec: docs/specifications/receiving-location-authority-i-la-c2-warehouse-status.md §4). PURE and
// DETERMINISTIC classification + planning + manifest validation + the execute staging that turns legacy
// warehouses into governed §3A MIGRATED records THROUGH an injected transaction/store seam. NOT exported
// from functions/src/index.ts; no callable; no production read/write here (the operator CLI wires real
// deps lazily and is dry-run by default). Governed by the merged shared §3A validator.
//
// Contract highlights (§4): dry-run is the default; execute re-reads live state and recomputes each
// pre-state fingerprint before any write, failing closed on ANY drift; unambiguous legacy records follow
// the ratified status-derivation matrix; contradictory/malformed records require an exact Owner-authored
// resolution-manifest entry; migrated records get the complete MIGRATED envelope (status, version 1,
// updatedAt/By, provenance MIGRATED, governanceInitializedAt/By), preserve an authentic createdAt/By pair
// only when both are valid (never fabricated), and drop legacy `active` in the same trusted write;
// already-governed records are byte-stable no-ops; reruns are idempotent; stop on the first integrity
// failure with no partial migration.

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { validateGovernedWarehouse } from "./governedWarehouseValidation.js";
import { WAREHOUSE_STATUSES, type WarehouseStatus, type GovernedWarehouse } from "../types/warehouse.js";

export const MIGRATION_INITIAL_VERSION = 1;

// -------- sanitized error taxonomy --------
export type MigrationFailureCode =
  | "INVALID_INPUT"
  | "MANIFEST_INVALID"
  | "AMBIGUOUS_UNRESOLVED"
  | "STALE_PRESTATE"
  | "RECORD_DISAPPEARED"
  | "MIGRATION_INTEGRITY";
export class WarehouseMigrationError extends Error {
  readonly code: MigrationFailureCode;
  constructor(code: MigrationFailureCode, message: string) { super(message); this.code = code; this.name = new.target.name; }
}

// -------- pure helpers (local canonical hash; opaque + deterministic) --------
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
function isNonBlank(v: unknown): v is string { return typeof v === "string" && v.trim() !== ""; }

// A sanitized, deterministic pre-state fingerprint over the WHOLE stored record (an opaque hash -- no raw
// field value is ever exposed). Any drift to the document changes the fingerprint, so a manifest authored
// against a prior state fails closed at execute.
export function warehouseGovernanceFingerprint(data: unknown): string {
  return sha256(canonicalJson(data));
}

export type MigrationCategory = "GOVERNED" | "DERIVE" | "AMBIGUOUS";
export interface ClassifiedWarehouse {
  readonly warehouseId: string;
  readonly category: MigrationCategory;
  readonly derivedStatus: WarehouseStatus | null; // set iff DERIVE
  readonly fingerprint: string;
}

// Deterministic classification of a single stored record against the §4 matrix. `data` is the raw stored
// document; `warehouseId` is its Firestore document id.
export function classifyWarehouse(warehouseId: string, data: unknown): ClassifiedWarehouse {
  const fingerprint = warehouseGovernanceFingerprint(data);
  // Already a governed §3A record (bound to its doc id) -> byte-stable no-op.
  if (validateGovernedWarehouse(data, warehouseId).valid) {
    return { warehouseId, category: "GOVERNED", derivedStatus: null, fingerprint };
  }
  if (!isPlainObject(data)) return { warehouseId, category: "AMBIGUOUS", derivedStatus: null, fingerprint };
  const statusPresent = hasOwn(data, "status");
  const statusValid = typeof data.status === "string" && (WAREHOUSE_STATUSES as readonly string[]).includes(data.status);
  const activeFalse = data.active === false;
  const activeTrueOrAbsent = data.active === true || !hasOwn(data, "active");

  // Malformed status present (not in enum) -> ambiguous (manifest required).
  if (statusPresent && !statusValid) return { warehouseId, category: "AMBIGUOUS", derivedStatus: null, fingerprint };
  // Missing status -> derive from legacy active.
  if (!statusPresent) {
    return { warehouseId, category: "DERIVE", derivedStatus: activeFalse ? "INACTIVE" : "ACTIVE", fingerprint };
  }
  // Valid status present. Contradictions require a manifest.
  const s = data.status as WarehouseStatus;
  if ((s === "ACTIVE" && activeFalse) || (s === "INACTIVE" && data.active === true)) {
    return { warehouseId, category: "AMBIGUOUS", derivedStatus: null, fingerprint };
  }
  void activeTrueOrAbsent;
  // Valid status, non-contradictory (active absent, or active consistent) -> derive that status.
  return { warehouseId, category: "DERIVE", derivedStatus: s, fingerprint };
}

export interface LiveWarehouse { readonly warehouseId: string; readonly data: unknown; }
export interface MigrationPlan {
  readonly projectId: string;
  readonly governedCommit: string;
  readonly classified: readonly ClassifiedWarehouse[];
  readonly ambiguous: readonly ClassifiedWarehouse[];
  readonly counts: { readonly total: number; readonly governed: number; readonly derive: number; readonly ambiguous: number };
}

// Dry-run plan: classify the WHOLE live set deterministically. Pure; no writes.
export function planMigration(live: readonly LiveWarehouse[], pins: { projectId: string; governedCommit: string }): MigrationPlan {
  if (!isNonBlank(pins.projectId) || !isNonBlank(pins.governedCommit)) throw new WarehouseMigrationError("INVALID_INPUT", "projectId/governedCommit must be pinned");
  const seen = new Set<string>();
  const classified: ClassifiedWarehouse[] = [];
  for (const item of live) {
    if (!isNonBlank(item.warehouseId)) throw new WarehouseMigrationError("INVALID_INPUT", "warehouseId invalid");
    if (seen.has(item.warehouseId)) throw new WarehouseMigrationError("INVALID_INPUT", "duplicate warehouseId in live set");
    seen.add(item.warehouseId);
    classified.push(classifyWarehouse(item.warehouseId, item.data));
  }
  const ambiguous = classified.filter((c) => c.category === "AMBIGUOUS");
  const counts = {
    total: classified.length,
    governed: classified.filter((c) => c.category === "GOVERNED").length,
    derive: classified.filter((c) => c.category === "DERIVE").length,
    ambiguous: ambiguous.length,
  };
  return { projectId: pins.projectId, governedCommit: pins.governedCommit, classified, ambiguous, counts };
}

// -------- resolution manifest (Owner-authored, for ambiguous records only) --------
export interface ResolutionManifestEntry { readonly warehouseId: string; readonly intendedStatus: string; readonly preStateFingerprint: string; }
export interface ResolutionManifest { readonly projectId: string; readonly governedCommit: string; readonly entries: readonly ResolutionManifestEntry[]; }
export interface ManifestValidation { readonly valid: boolean; readonly resolved: ReadonlyMap<string, WarehouseStatus>; readonly reason: string | null; }

// Validate an Owner manifest against a plan's ambiguous set. Fails closed on missing / extra / duplicate /
// invalid-status / wrong-project / wrong-commit / stale-prestate entries.
export function validateResolutionManifest(manifest: unknown, plan: MigrationPlan): ManifestValidation {
  const bad = (reason: string): ManifestValidation => ({ valid: false, resolved: new Map(), reason });
  if (!isPlainObject(manifest)) return bad("manifest_not_object");
  if (manifest.projectId !== plan.projectId) return bad("wrong_project");
  if (manifest.governedCommit !== plan.governedCommit) return bad("wrong_commit");
  if (!Array.isArray(manifest.entries)) return bad("entries_not_array");

  const ambiguousById = new Map(plan.ambiguous.map((a) => [a.warehouseId, a]));
  const resolved = new Map<string, WarehouseStatus>();
  for (const entry of manifest.entries) {
    if (!isPlainObject(entry) || !isNonBlank(entry.warehouseId)) return bad("entry_malformed");
    const id = entry.warehouseId;
    if (resolved.has(id)) return bad("duplicate_entry");
    const target = ambiguousById.get(id);
    if (!target) return bad("extra_entry"); // an entry for a non-ambiguous (or unknown) id
    if (typeof entry.intendedStatus !== "string" || !(WAREHOUSE_STATUSES as readonly string[]).includes(entry.intendedStatus)) return bad("invalid_status");
    if (entry.preStateFingerprint !== target.fingerprint) return bad("stale_prestate");
    resolved.set(id, entry.intendedStatus as WarehouseStatus);
  }
  // Every ambiguous record must have an entry.
  for (const a of plan.ambiguous) if (!resolved.has(a.warehouseId)) return bad("missing_entry");
  return { valid: true, resolved, reason: null };
}

// Build the full governed §3A MIGRATED record for a legacy document. Preserves an authentic createdAt/By
// pair ONLY when both are valid (never fabricated); adds governanceInitializedAt/By; drops legacy `active`.
export function buildMigratedRecord(warehouseId: string, data: unknown, status: WarehouseStatus, ctx: { actorId: string; nowMillis: number }): GovernedWarehouse {
  const ts = Timestamp.fromMillis(ctx.nowMillis);
  const record: GovernedWarehouse = {
    id: warehouseId,
    name: isPlainObject(data) && isNonBlank(data.name) ? data.name : "",
    location: isPlainObject(data) && isNonBlank(data.location) ? data.location : "",
    status,
    version: MIGRATION_INITIAL_VERSION,
    updatedAt: ts,
    updatedBy: ctx.actorId,
    provenance: "MIGRATED",
    governanceInitializedAt: ts,
    governanceInitializedBy: ctx.actorId,
  };
  if (isPlainObject(data) && data.createdAt instanceof Timestamp && isNonBlank(data.createdBy)) {
    record.createdAt = data.createdAt;
    record.createdBy = data.createdBy;
  }
  return record;
}

// The injected staging seam: re-reads live state and stages governed writes. `reRead` returns the current
// stored data (null if the doc disappeared); `stage` persists the full governed record (replacing the doc,
// which drops any legacy `active`). Implemented over a Firestore transaction by the caller.
export interface MigrationStore {
  reRead(warehouseId: string): Promise<unknown>;
  stage(warehouseId: string, record: GovernedWarehouse): void;
}
export interface MigrationExecuteResult {
  readonly migrated: readonly string[];
  readonly skippedGoverned: readonly string[];
  readonly counts: { readonly migrated: number; readonly skippedGoverned: number };
}

// EXECUTE the migration bound to a dry-run `plan`. Validates the manifest against the plan's ambiguous set
// FIRST (no writes if unresolved). Then, per non-governed record: re-reads live state, recomputes the
// fingerprint, and fails closed (STALE_PRESTATE) on ANY drift from the plan; builds + self-validates the
// governed record; stages it. GOVERNED records are byte-stable no-ops. Stops on the first integrity
// failure (throws) -- the caller's transaction makes it all-or-nothing.
export async function executeMigration(args: {
  plan: MigrationPlan;
  manifest: unknown;
  store: MigrationStore;
  actorId: string;
  now: () => Date;
}): Promise<MigrationExecuteResult> {
  if (!isNonBlank(args.actorId)) throw new WarehouseMigrationError("INVALID_INPUT", "actorId invalid");
  const nowMillis = args.now().getTime();

  // Whole-set validation before ANY write: the manifest must exactly resolve the ambiguous set.
  const manifestCheck = validateResolutionManifest(args.manifest, args.plan);
  if (args.plan.ambiguous.length > 0 || (isPlainObject(args.manifest) && Array.isArray(args.manifest.entries) && args.manifest.entries.length > 0)) {
    if (!manifestCheck.valid) throw new WarehouseMigrationError("MANIFEST_INVALID", `manifest invalid: ${manifestCheck.reason}`);
  }

  const migrated: string[] = [];
  const skippedGoverned: string[] = [];
  for (const c of args.plan.classified) {
    if (c.category === "GOVERNED") { skippedGoverned.push(c.warehouseId); continue; }
    // Re-read live + recompute fingerprint; any drift from the planned pre-state fails closed.
    const live = await args.store.reRead(c.warehouseId);
    if (live === null || live === undefined) throw new WarehouseMigrationError("RECORD_DISAPPEARED", "warehouse disappeared before migration");
    if (warehouseGovernanceFingerprint(live) !== c.fingerprint) throw new WarehouseMigrationError("STALE_PRESTATE", "live pre-state changed since dry-run");

    const status = c.category === "DERIVE" ? (c.derivedStatus as WarehouseStatus) : manifestCheck.resolved.get(c.warehouseId);
    if (status === undefined) throw new WarehouseMigrationError("AMBIGUOUS_UNRESOLVED", "ambiguous record has no resolution");

    const record = buildMigratedRecord(c.warehouseId, live, status, { actorId: args.actorId, nowMillis });
    if (!validateGovernedWarehouse(record, c.warehouseId).valid) throw new WarehouseMigrationError("MIGRATION_INTEGRITY", "built record is not governed");
    args.store.stage(c.warehouseId, record);
    migrated.push(c.warehouseId);
  }
  return { migrated, skippedGoverned, counts: { migrated: migrated.length, skippedGoverned: skippedGoverned.length } };
}
