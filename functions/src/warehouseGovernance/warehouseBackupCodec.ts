// EI Phase-2 Receiving -- Gate E2-V: LOSSLESS, PURE typed backup/restore codec for the `warehouses`
// collection. The Gate-E2 migration (I-LA3) commits governed §3A records over legacy documents in ONE
// transaction, then verifies AFTER commit -- so a post-commit verification failure can leave committed
// records with no usable rollback unless a byte/semantic-faithful pre-migration snapshot exists. Plain
// JSON.stringify over Firestore documents is NOT lossless (a Timestamp does not round-trip), so this
// module encodes every stored value into an explicit typed envelope and decodes it back to the exact
// Firestore type, or FAILS CLOSED on any value it cannot round-trip. No I/O here: the operator CLI
// (warehouseBackupRestoreCli.js) supplies the Admin-SDK read/write seams.

import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

export class WarehouseBackupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "WarehouseBackupError"; this.code = code; }
}

// ---- typed value codec ---------------------------------------------------
// Supported (lossless): null, boolean, finite number, string, Timestamp, and arrays/plain-maps of the
// same. Anything else (undefined, NaN/Infinity, GeoPoint, DocumentReference, Bytes/Buffer, function,
// symbol, bigint) FAILS CLOSED -- we never silently drop or coerce a value we cannot faithfully restore.

type EncodedValue =
  | null
  | boolean
  | number
  | string
  | { readonly __fsType: "timestamp"; readonly seconds: number; readonly nanoseconds: number }
  | readonly EncodedValue[]
  | { readonly [k: string]: EncodedValue };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function encodeValue(value: unknown, pathHint = "$"): EncodedValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WarehouseBackupError("UNSUPPORTED_VALUE", `non-finite number at ${pathHint}`);
    return value;
  }
  if (value instanceof Timestamp) {
    return { __fsType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map((v, i) => encodeValue(v, `${pathHint}[${i}]`));
  if (isPlainObject(value)) {
    const out: Record<string, EncodedValue> = {};
    for (const k of Object.keys(value)) {
      if (k.startsWith("__fsType")) throw new WarehouseBackupError("RESERVED_KEY", `reserved key "${k}" at ${pathHint}`);
      out[k] = encodeValue(value[k], `${pathHint}.${k}`);
    }
    return out;
  }
  // undefined, bigint, symbol, function, Buffer, GeoPoint, DocumentReference, class instances -> fail closed.
  throw new WarehouseBackupError("UNSUPPORTED_VALUE", `unsupported value type (${typeof value}) at ${pathHint}`);
}

function isEncodedTimestamp(v: unknown): v is { __fsType: "timestamp"; seconds: number; nanoseconds: number } {
  return isPlainObject(v) && (v as Record<string, unknown>).__fsType === "timestamp"
    && Number.isInteger((v as Record<string, unknown>).seconds)
    && Number.isInteger((v as Record<string, unknown>).nanoseconds);
}

export function decodeValue(value: unknown, pathHint = "$"): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `non-finite number at ${pathHint}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => decodeValue(v, `${pathHint}[${i}]`));
  if (isEncodedTimestamp(value)) return new Timestamp(value.seconds, value.nanoseconds);
  if (isPlainObject(value)) {
    if ("__fsType" in value) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `malformed typed envelope at ${pathHint}`);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = decodeValue((value as Record<string, unknown>)[k], `${pathHint}.${k}`);
    return out;
  }
  throw new WarehouseBackupError("CORRUPT_SNAPSHOT", `undecodable value at ${pathHint}`);
}

// ---- snapshot envelope ---------------------------------------------------

export interface LiveDoc { readonly warehouseId: string; readonly data: unknown; }
export interface WarehouseSnapshot {
  readonly kind: "warehouse-backup";
  readonly projectId: string;
  readonly governedCommit: string;
  readonly capturedCount: number;
  readonly docIds: readonly string[];              // sorted, canonical identity of the captured set
  readonly docs: { readonly [warehouseId: string]: EncodedValue };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function snapshotHash(snapshot: WarehouseSnapshot): string {
  // Hash the whole envelope canonically -- stable across key ordering; binds identity + content + pins.
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

function assertPins(projectId: string, governedCommit: string): void {
  if (projectId !== "taylor-parts") throw new WarehouseBackupError("INVALID_INPUT", "projectId must be taylor-parts");
  if (!/^[0-9a-f]{40}$/.test(governedCommit)) throw new WarehouseBackupError("INVALID_INPUT", "governedCommit must be a 40-hex commit");
}

export function encodeSnapshot(live: readonly LiveDoc[], pins: { projectId: string; governedCommit: string }): WarehouseSnapshot {
  assertPins(pins.projectId, pins.governedCommit);
  const docs: Record<string, EncodedValue> = {};
  const ids: string[] = [];
  for (const d of live) {
    if (typeof d.warehouseId !== "string" || d.warehouseId.trim() === "") throw new WarehouseBackupError("INVALID_INPUT", "blank warehouseId in live set");
    if (Object.prototype.hasOwnProperty.call(docs, d.warehouseId)) throw new WarehouseBackupError("INVALID_INPUT", `duplicate warehouseId ${d.warehouseId}`);
    if (!isPlainObject(d.data)) throw new WarehouseBackupError("UNSUPPORTED_VALUE", `warehouse ${d.warehouseId} data is not a map`);
    docs[d.warehouseId] = encodeValue(d.data, `$(${d.warehouseId})`) as { [k: string]: EncodedValue };
    ids.push(d.warehouseId);
  }
  ids.sort();
  return { kind: "warehouse-backup", projectId: pins.projectId, governedCommit: pins.governedCommit, capturedCount: ids.length, docIds: ids, docs };
}

export function validateSnapshotShape(snapshot: unknown): WarehouseSnapshot {
  if (!isPlainObject(snapshot)) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "snapshot is not an object");
  const s = snapshot as Record<string, unknown>;
  if (s.kind !== "warehouse-backup") throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "wrong snapshot kind");
  if (typeof s.projectId !== "string" || typeof s.governedCommit !== "string") throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "missing pins");
  assertPins(s.projectId, s.governedCommit);
  if (!Array.isArray(s.docIds) || !isPlainObject(s.docs)) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "missing docIds/docs");
  const ids = s.docIds as unknown[];
  if (!ids.every((x) => typeof x === "string")) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "docIds not all strings");
  const sorted = [...(ids as string[])].sort();
  if (canonicalJson(ids) !== canonicalJson(sorted)) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "docIds not sorted-canonical");
  const docKeys = Object.keys(s.docs as Record<string, unknown>).sort();
  if (canonicalJson(docKeys) !== canonicalJson(sorted)) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "docs keys != docIds");
  if (s.capturedCount !== ids.length) throw new WarehouseBackupError("CORRUPT_SNAPSHOT", "capturedCount != docIds length");
  return s as unknown as WarehouseSnapshot;
}

// Decode the snapshot back to real Firestore-typed documents (validated shape first).
export function decodeSnapshot(snapshot: WarehouseSnapshot): readonly { warehouseId: string; data: Record<string, unknown> }[] {
  const validated = validateSnapshotShape(snapshot);
  return validated.docIds.map((id) => ({ warehouseId: id, data: decodeValue(validated.docs[id], `$(${id})`) as Record<string, unknown> }));
}

// ---- restore drift gate --------------------------------------------------
// A rollback is a bounded overwrite of EXACTLY the captured id set. Content differing from the snapshot
// is EXPECTED (that is the migration delta we are reverting) -- but the live IDENTITY set must equal the
// snapshot's: any id ADDED since capture (would be orphaned by a restore) or DELETED (nothing to restore
// over) makes the restore not bounded, so we FAIL CLOSED and require the Owner to reconcile first.

export interface RestorePlan {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly added: readonly string[];    // live ids not in the snapshot
  readonly deleted: readonly string[];  // snapshot ids not live
  readonly changedCount: number;        // ids whose live content differs from the snapshot (the revert target)
  readonly restoreCount: number;        // ids that will be written (== capturedCount when ok)
}

export function planRestore(
  snapshot: WarehouseSnapshot,
  live: readonly LiveDoc[],
  pins: { projectId: string; governedCommit: string },
): RestorePlan {
  const validated = validateSnapshotShape(snapshot);
  if (pins.projectId !== validated.projectId) return fail("project_mismatch");
  if (pins.governedCommit !== validated.governedCommit) return fail("commit_mismatch");
  const liveIds = new Set<string>();
  for (const d of live) {
    if (typeof d.warehouseId !== "string" || d.warehouseId.trim() === "") return fail("live_blank_id");
    if (liveIds.has(d.warehouseId)) return fail("live_duplicate_id");
    liveIds.add(d.warehouseId);
  }
  const snapIds = new Set(validated.docIds);
  const added = [...liveIds].filter((id) => !snapIds.has(id)).sort();
  const deleted = [...snapIds].filter((id) => !liveIds.has(id)).sort();
  if (added.length > 0 || deleted.length > 0) {
    return { ok: false, reason: "live_set_drift", added, deleted, changedCount: 0, restoreCount: 0 };
  }
  // Count content changes (the revert target) for evidence -- not blocking.
  const liveById = new Map(live.map((d) => [d.warehouseId, d.data]));
  let changedCount = 0;
  for (const id of validated.docIds) {
    const encodedLive = canonicalJson(encodeValue(liveById.get(id), `$(${id})`));
    if (encodedLive !== canonicalJson(validated.docs[id])) changedCount += 1;
  }
  return { ok: true, reason: null, added, deleted, changedCount, restoreCount: validated.docIds.length };
}

function fail(reason: string): RestorePlan {
  return { ok: false, reason, added: [], deleted: [], changedCount: 0, restoreCount: 0 };
}
