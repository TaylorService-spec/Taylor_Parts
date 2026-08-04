// Receiving Location Authority -- I-LA4/I-LR: the INERT, UNEXPORTED trusted backend service that returns
// eligible Receiving warehouse OPTIONS (ratified O-3: trusted backend-served options; the frontend never
// reads warehouses directly and the Customer RawWarehouse mirror is SUPERSEDED for this flow). NOT
// exported from functions/src/index.ts; no callable; production-inert (no caller). Governed by the merged
// §3A validator: only fully governed, status===ACTIVE warehouses become options.
//
// The service reads the COMPLETE candidate warehouse set and its authorization THROUGH one injected,
// read-consistent transaction seam, so a concurrent authorization revocation cannot return options (the
// read set changes -> the transaction retries -> the re-checked authorization denies). It returns ONLY a
// sanitized DTO ({ value, label, type: "WAREHOUSE" }) -- never a raw document, status, governance
// metadata, error, or unexpected field. It is deterministic and non-mutating, and fails closed on
// authorization failure, malformed source state, read failure, or an invalid request envelope.
//
// PINNED first-slice contract: the request envelope carries NO fields; the initially eligible personas
// are admin/dispatcher contexts only, decided by the injected authorize seam (no Firestore client read is
// broadened here). PARTS_ASSOCIATE stays unavailable until the separate Receiving grant gate.

import type { Transaction } from "firebase-admin/firestore";
import { validateGovernedWarehouse } from "./governedWarehouseValidation.js";

// -------- sanitized error taxonomy --------
export type ReceivingOptionsFailureCode = "INVALID_REQUEST" | "PERMISSION_DENIED" | "SOURCE_UNAVAILABLE";
export class ReceivingLocationOptionsError extends Error {
  readonly code: ReceivingOptionsFailureCode;
  constructor(code: ReceivingOptionsFailureCode, message: string) { super(message); this.code = code; this.name = new.target.name; }
}

export interface ReceivingLocationOption { readonly value: string; readonly label: string; readonly type: "WAREHOUSE"; }
export interface ReceivingOptionsActor { readonly kind: "USER" | "SYSTEM"; readonly id: string; }
export interface CandidateWarehouse { readonly warehouseId: string; readonly data: unknown; }

// Injected, read-consistent dependencies. `runRead` provides the single transaction under which both the
// authorization check and the candidate read happen; `authorize` reads through that txn (commit-time
// consistent); `readCandidateWarehouses` returns the COMPLETE candidate set through that txn.
export interface ReceivingLocationOptionsDeps {
  readonly actor: ReceivingOptionsActor;
  readonly authorize: (txn: Transaction, actorId: string) => Promise<boolean>;
  readonly readCandidateWarehouses: (txn: Transaction) => Promise<readonly CandidateWarehouse[]>;
  readonly runRead: <T>(fn: (txn: Transaction) => Promise<T>) => Promise<T>;
  readonly __afterAuthReadHook?: () => Promise<void>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function isNonBlank(v: unknown): v is string { return typeof v === "string" && v.trim() !== ""; }

// label = trimmed non-blank name, otherwise the warehouseId. (A governed §3A record always has a non-blank
// name, so the fallback is defensive; it is unit-tested directly.)
export function buildOptionLabel(name: unknown, warehouseId: string): string {
  return isNonBlank(name) ? name.trim() : warehouseId;
}

// Deterministic order: label (code-unit), then warehouseId (code-unit). Locale-independent + stable.
function compareOptions(a: ReceivingLocationOption, b: ReceivingLocationOption): number {
  if (a.label < b.label) return -1;
  if (a.label > b.label) return 1;
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

// Return the eligible Receiving WAREHOUSE options for the (trusted) actor. `request` is the UNTRUSTED
// envelope (first slice: no fields accepted). Never mutates inputs; never returns raw warehouse data.
export async function listEligibleReceivingLocationOptions(request: unknown, deps: ReceivingLocationOptionsDeps): Promise<readonly ReceivingLocationOption[]> {
  // Envelope: a plain object with NO own properties (any field is rejected fail-closed).
  if (!isPlainObject(request)) throw new ReceivingLocationOptionsError("INVALID_REQUEST", "request is not an object");
  if (Object.keys(request).length > 0) throw new ReceivingLocationOptionsError("INVALID_REQUEST", "unknown request field");
  // Trusted actor context (never from the request).
  const actor = deps.actor;
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !isNonBlank(actor.id)) {
    throw new ReceivingLocationOptionsError("PERMISSION_DENIED", "trusted actor context missing");
  }

  // The authorization check and the candidate read happen under ONE injected, read-consistent
  // transaction. Transaction-control errors (e.g. ABORTED from a concurrent authorization revocation on a
  // read-locked doc) are NOT swallowed here -- they propagate so the seam can retry; on retry the
  // re-checked authorization denies. Any error that survives the seam and is not already a sanitized
  // governed failure is mapped to a sanitized SOURCE_UNAVAILABLE (fail closed; never a raw error).
  try {
    return await deps.runRead(async (txn) => {
      const authorized = await deps.authorize(txn, actor.id);
      if (authorized !== true) throw new ReceivingLocationOptionsError("PERMISSION_DENIED", "actor is not authorized to list receiving locations");
      if (deps.__afterAuthReadHook) await deps.__afterAuthReadHook();

      const candidates = await deps.readCandidateWarehouses(txn);
      const options: ReceivingLocationOption[] = [];
      const seen = new Set<string>();
      for (const c of candidates) {
        if (!isNonBlank(c.warehouseId)) continue; // malformed candidate identity -> exclude
        const parsed = validateGovernedWarehouse(c.data, c.warehouseId); // binds stored id to the doc id
        if (!parsed.valid || parsed.value.status !== "ACTIVE") continue; // exclude non-governed / non-ACTIVE
        if (seen.has(c.warehouseId)) continue; // duplicate-identity protection (keep first)
        seen.add(c.warehouseId);
        options.push({ value: c.warehouseId, label: buildOptionLabel(parsed.value.name, c.warehouseId), type: "WAREHOUSE" });
      }
      options.sort(compareOptions);
      return options;
    });
  } catch (err) {
    if (err instanceof ReceivingLocationOptionsError) throw err; // PERMISSION_DENIED passes through
    throw new ReceivingLocationOptionsError("SOURCE_UNAVAILABLE", "candidate warehouse source unavailable");
  }
}
