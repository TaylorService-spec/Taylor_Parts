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
import { naturalIdentityKey } from "./contracts/entityContract.js";
import {
  createAccountFromImport,
  normalizeAccountSearchName,
  AccountImportError,
} from "../account/accountImportCommand.js";
import { ACCOUNTS_COLLECTION } from "../account/accountPortfolioSummary.js";

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

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/**
 * The document id an imported Customer is created at.
 *
 * Derived from the name for the same reason a Part's id is derived from its part number: a
 * re-import lands on the same document, and the command's own already-exists check becomes
 * the idempotency backstop without import needing a second uniqueness authority.
 *
 * Prefixed "IMP-" and NOT a bare slug, which matters here in a way it did not for Parts.
 * Accounts created through the interface carry Firestore auto-ids, and other collections
 * reference them. A derived id must be recognisable as one and must not plausibly collide
 * with an auto-id -- so it is namespaced, and a collision would be refused rather than
 * silently overwriting a customer somebody else created.
 */
export function deriveImportedAccountId(name: string): string {
  const slug = name.trim().toUpperCase().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `IMP-${slug || "CUSTOMER"}-${shortDigest(naturalIdentityKey(name))}`;
}

/** FNV-1a, 32-bit, base36 -- the same suffix scheme the Part id uses. */
function shortDigest(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, "0");
}

/**
 * Which of these customer names already exist?
 *
 * BY QUERY, unlike Parts, and the difference is the point. A Part's id is derived, so every
 * Part that could exist occupies a predictable document. Customers are not: the ones already
 * in EOS were created through the interface with auto-ids, so the only thing both sides
 * share is the name -- and `nameLower` is the field the customer search already queries,
 * which means it is populated for every customer however they were created.
 *
 * Checking only the derived id would compare imported customers against imported customers
 * and conclude that a customer created by hand last year does not exist.
 */
export async function loadExistingCustomerIdentities(
  names: readonly string[],
  db: Firestore = getFirestore(),
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];

  // Firestore caps an `in` filter at 30 values.
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await db
      .collection(ACCOUNTS_COLLECTION)
      .where("nameLower", "in", chunk.map((n) => normalizeAccountSearchName(n)))
      .get();
    for (const doc of snap.docs) {
      const name = String((doc.data() ?? {}).name ?? "");
      if (name) found.add(naturalIdentityKey(name));
    }
  }

  return found;
}

/**
 * The Customers writer, over the trusted account-import command.
 *
 * The command -- not a direct set. It enforces `customer.record.create`, refuses the two
 * governed commercial fields, derives `nameLower`, writes Timestamp-typed stamps and audits,
 * all in one transaction. This function chooses the document id and translates errors, and
 * that is deliberately all it does.
 */
export function firestoreCustomerWriter(actorUid: string, db?: Firestore): RowWriter {
  return {
    async write(draft, idempotencyKey) {
      try {
        const outcome = await createAccountFromImport(
          { actorUid, idempotencyKey, accountId: deriveImportedAccountId(String(draft.name ?? "")), draft },
          db ? { db } : undefined,
        );
        return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
      } catch (err) {
        if (err instanceof AccountImportError) {
          const message =
            err.code === "ALREADY_EXISTS"
              ? "A customer with this name already exists."
              : err.code === "UNAUTHORIZED"
                ? "You are not authorized to create customers."
                : err.code === "GOVERNED_FIELD_REFUSED"
                  ? "This row sets a governed commercial field, which import cannot write."
                  : "The row failed the Customer validation rules.";
          return { kind: "failed", code: err.code, message };
        }
        return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
      }
    },
  };
}
