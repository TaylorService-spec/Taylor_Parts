// EOS Data Import -- the FIRESTORE side of the portability boundary.
//
// Everything storage-shaped about import lives here and nowhere else. The modules above
// this one (contract, intake, preview, job model, execution) name no collection, import no
// firebase-admin, and would run unchanged against a customer-hosted data plane. This file
// is the Verenward-hosted implementation of the three things they need from a data plane:
//
//   1. WHICH IDENTITIES ALREADY EXIST   -> loadExistingPartIdentities
//   2. WHERE JOBS ARE KEPT              -> firestoreImportJobStore
//   3. HOW A RECORD IS ACTUALLY WRITTEN -> firestorePartWriter
//
// The third is the one worth reading twice. It does NOT write a Part. It calls the SAME
// governed command a human uses (partMaster's createPart), which enforces the catalog
// capability, validates the Part, checks referential integrity, keys idempotency and writes
// its own audit event inside one transaction. Import therefore has no write authority of
// its own and cannot acquire one by editing this file -- the only way to widen what import
// can write is to widen what the governed command allows, in front of that command's own
// reviewers.

import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  createPart,
  AlreadyExistsError,
  InvalidInputError,
  UnauthorizedActorError,
  IdempotencyConflictError,
} from "../partMaster/partMasterCommands.js";
import { PARTS_COLLECTION } from "../partMaster/partMasterRepository.js";
import type { PartInput } from "../partMaster/validation.js";
import { derivePartId } from "./contracts/partImportContract.js";
import type { RowWriter, WriteOutcome } from "./importExecution.js";
import type { ImportJob } from "./importJob.js";
import { partIdentityKey } from "./importPreview.js";

/** Where import jobs live. The ONLY collection this feature introduces. */
export const IMPORT_JOBS_COLLECTION = "data_import_jobs";

/** Firestore rejects a getAll() with an unbounded argument list; 300 keeps well clear. */
const IDENTITY_LOOKUP_CHUNK = 300;

/**
 * Which of these Internal Part Numbers already have a Part?
 *
 * BY DOCUMENT ID, NOT BY QUERY, and that is a design decision rather than an optimization.
 * partId is derived deterministically from the IPN (derivePartId), so "does this IPN
 * exist" is answerable by reading the document it would occupy. A `where` on a nested
 * field would need a composite index, would answer a slightly different question, and
 * would introduce a second uniqueness authority alongside the command's own already-exists
 * check. Reading the id keeps there being exactly one.
 */
export async function loadExistingPartIdentities(
  internalPartNumbers: readonly string[],
  db: Firestore = getFirestore(),
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  const unique = [...new Set(internalPartNumbers.map((n) => n.trim()).filter((n) => n.length > 0))];

  for (let i = 0; i < unique.length; i += IDENTITY_LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + IDENTITY_LOOKUP_CHUNK);
    const refs = chunk.map((ipn) => db.collection(PARTS_COLLECTION).doc(derivePartId(ipn)));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      if (snap.exists) found.add(partIdentityKey(chunk[idx]));
    });
  }

  return found;
}

export interface ImportJobStore {
  get(jobId: string): Promise<ImportJob | null>;
  put(job: ImportJob): Promise<void>;
  /**
   * Move a STAGED job to EXECUTING, refusing if it is not still STAGED.
   *
   * Transactional because this is the double-click guard: two concurrent execute requests
   * for one job must not both pass. The pure model's assertExecutable states the rule;
   * this is where the rule is actually enforced against concurrency.
   */
  claimForExecution(job: ImportJob): Promise<boolean>;
  listRecent(limit: number): Promise<readonly ImportJob[]>;
}

/**
 * Drop undefined values, recursively.
 *
 * A canonical draft leaves its optional fields undefined -- which is the right shape for a
 * domain value and an ILLEGAL one for Firestore, which rejects the whole write. This is
 * exactly the kind of storage-specific concession that belongs on this side of the
 * portability boundary and nowhere else: the job model must not learn to avoid undefined
 * because one data plane cannot store it.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
export function firestoreImportJobStore(db: Firestore = getFirestore()): ImportJobStore {
  const col = () => db.collection(IMPORT_JOBS_COLLECTION);

  return {
    async get(jobId) {
      const snap = await col().doc(jobId).get();
      return snap.exists ? (snap.data() as ImportJob) : null;
    },

    async put(job) {
      await col().doc(job.jobId).set(stripUndefined(job));
    },

    async claimForExecution(job) {
      return db.runTransaction(async (txn) => {
        const ref = col().doc(job.jobId);
        const snap = await txn.get(ref);
        if (!snap.exists) return false;
        if ((snap.data() ?? {}).status !== "STAGED") return false;
        txn.set(ref, stripUndefined(job));
        return true;
      });
    },

    async listRecent(limit) {
      // Ordered by the staging timestamp, which is an ISO-8601 string -- lexical order is
      // chronological order for that format, so this needs no separate numeric field.
      const snap = await col().orderBy("stagedAt", "desc").limit(limit).get();
      return snap.docs.map((d) => d.data() as ImportJob);
    },
  };
}

/**
 * Domain refusals -> stable per-row codes.
 *
 * Each maps to a GENERIC message. The row already carries its own identity, so naming the
 * conflicting record here would add nothing an admin needs and would leak stored state
 * across the trust boundary of a feature whose whole job is bulk access to it.
 */
function classify(err: unknown): WriteOutcome {
  if (err instanceof AlreadyExistsError) {
    return { kind: "failed", code: "ALREADY_EXISTS", message: "A Part with this identity already exists." };
  }
  if (err instanceof InvalidInputError) {
    return { kind: "failed", code: "INVALID", message: "The row failed the Part validation rules." };
  }
  if (err instanceof UnauthorizedActorError) {
    return { kind: "failed", code: "UNAUTHORIZED", message: "You are not authorized to create Parts." };
  }
  if (err instanceof IdempotencyConflictError) {
    return { kind: "failed", code: "IDEMPOTENCY_CONFLICT", message: "This row was already submitted with different content." };
  }
  return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
}

/**
 * A canonical draft -> the governed command's input.
 *
 * Exported so the two decisions it encodes are testable without a Firestore: the derived
 * partId (which is what makes a re-import collide with itself) and the forced DRAFT status.
 */
export function toGovernedPartInput(draft: Readonly<Record<string, unknown>>): PartInput {
  const ipn = String(draft.internalPartNumber);
  return { ...draft, partId: derivePartId(ipn), internalPartNumber: ipn, status: "DRAFT" } as PartInput;
}
/**
 * The Parts writer, over the governed command.
 *
 * status is forced to DRAFT regardless of what the file said. A spreadsheet can assert
 * that a Part is ACTIVE; it cannot substantiate it, and an import that activates catalog
 * records on a supplier's say-so hands lifecycle authority to whoever exported the file.
 * DRAFT is the honest landing state, and inventory.catalog.activate remains the separate
 * authority it already was.
 */
export function firestorePartWriter(actorUid: string, db?: Firestore): RowWriter {
  return {
    async write(draft, idempotencyKey) {
      const part = toGovernedPartInput(draft);

      try {
        const outcome = await createPart({ actorUid, idempotencyKey, part }, db ? { db } : undefined);
        return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
      } catch (err) {
        return classify(err);
      }
    },
  };
}
