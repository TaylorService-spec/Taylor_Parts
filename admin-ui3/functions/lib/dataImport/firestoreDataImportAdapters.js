"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPORT_JOBS_COLLECTION = void 0;
exports.loadExistingPartIdentities = loadExistingPartIdentities;
exports.firestoreImportJobStore = firestoreImportJobStore;
exports.toGovernedPartInput = toGovernedPartInput;
exports.firestorePartWriter = firestorePartWriter;
exports.deriveImportedAccountId = deriveImportedAccountId;
exports.loadExistingCustomerIdentities = loadExistingCustomerIdentities;
exports.firestoreCustomerWriter = firestoreCustomerWriter;
exports.loadExistingEquipmentSerials = loadExistingEquipmentSerials;
exports.loadEquipmentReferences = loadEquipmentReferences;
exports.firestoreEquipmentWriter = firestoreEquipmentWriter;
const firestore_1 = require("firebase-admin/firestore");
const partMasterCommands_js_1 = require("../partMaster/partMasterCommands.js");
const partMasterRepository_js_1 = require("../partMaster/partMasterRepository.js");
const partImportContract_js_1 = require("./contracts/partImportContract.js");
const importPreview_js_1 = require("./importPreview.js");
const entityContract_js_1 = require("./contracts/entityContract.js");
const accountImportCommand_js_1 = require("../account/accountImportCommand.js");
const crmWriterState_js_1 = require("../crm/crmWriterState.js");
const accountPortfolioSummary_js_1 = require("../account/accountPortfolioSummary.js");
const equipmentImportCommand_js_1 = require("../equipmentInstall/equipmentImportCommand.js");
const equipmentImportContract_js_1 = require("./contracts/equipmentImportContract.js");
/** Where import jobs live. The ONLY collection this feature introduces. */
exports.IMPORT_JOBS_COLLECTION = "data_import_jobs";
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
async function loadExistingPartIdentities(internalPartNumbers, db = (0, firestore_1.getFirestore)()) {
    const found = new Set();
    const unique = [...new Set(internalPartNumbers.map((n) => n.trim()).filter((n) => n.length > 0))];
    for (let i = 0; i < unique.length; i += IDENTITY_LOOKUP_CHUNK) {
        const chunk = unique.slice(i, i + IDENTITY_LOOKUP_CHUNK);
        const refs = chunk.map((ipn) => db.collection(partMasterRepository_js_1.PARTS_COLLECTION).doc((0, partImportContract_js_1.derivePartId)(ipn)));
        const snaps = await db.getAll(...refs);
        snaps.forEach((snap, idx) => {
            if (snap.exists)
                found.add((0, importPreview_js_1.partIdentityKey)(chunk[idx]));
        });
    }
    return found;
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
function stripUndefined(value) {
    if (Array.isArray(value))
        return value.map((v) => stripUndefined(v));
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v !== undefined)
                out[k] = stripUndefined(v);
        }
        return out;
    }
    return value;
}
function firestoreImportJobStore(db = (0, firestore_1.getFirestore)()) {
    const col = () => db.collection(exports.IMPORT_JOBS_COLLECTION);
    return {
        async get(jobId) {
            const snap = await col().doc(jobId).get();
            return snap.exists ? snap.data() : null;
        },
        async put(job) {
            await col().doc(job.jobId).set(stripUndefined(job));
        },
        async claimForExecution(job) {
            return db.runTransaction(async (txn) => {
                const ref = col().doc(job.jobId);
                const snap = await txn.get(ref);
                if (!snap.exists)
                    return false;
                if ((snap.data() ?? {}).status !== "STAGED")
                    return false;
                txn.set(ref, stripUndefined(job));
                return true;
            });
        },
        async listRecent(limit) {
            // Ordered by the staging timestamp, which is an ISO-8601 string -- lexical order is
            // chronological order for that format, so this needs no separate numeric field.
            const snap = await col().orderBy("stagedAt", "desc").limit(limit).get();
            return snap.docs.map((d) => d.data());
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
function classify(err) {
    if (err instanceof partMasterCommands_js_1.AlreadyExistsError) {
        return { kind: "failed", code: "ALREADY_EXISTS", message: "A Part with this identity already exists." };
    }
    if (err instanceof partMasterCommands_js_1.InvalidInputError) {
        return { kind: "failed", code: "INVALID", message: "The row failed the Part validation rules." };
    }
    if (err instanceof partMasterCommands_js_1.UnauthorizedActorError) {
        return { kind: "failed", code: "UNAUTHORIZED", message: "You are not authorized to create Parts." };
    }
    if (err instanceof partMasterCommands_js_1.IdempotencyConflictError) {
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
function toGovernedPartInput(draft) {
    const ipn = String(draft.internalPartNumber);
    return { ...draft, partId: (0, partImportContract_js_1.derivePartId)(ipn), internalPartNumber: ipn, status: "DRAFT" };
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
function firestorePartWriter(actorUid, db) {
    return {
        async write(draft, idempotencyKey) {
            const part = toGovernedPartInput(draft);
            try {
                const outcome = await (0, partMasterCommands_js_1.createPart)({ actorUid, idempotencyKey, part }, db ? { db } : undefined);
                return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
            }
            catch (err) {
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
function deriveImportedAccountId(name) {
    const slug = name.trim().toUpperCase().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return `IMP-${slug || "CUSTOMER"}-${shortDigest((0, entityContract_js_1.naturalIdentityKey)(name))}`;
}
/** FNV-1a, 32-bit, base36 -- the same suffix scheme the Part id uses. */
function shortDigest(value) {
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
async function loadExistingCustomerIdentities(names, db = (0, firestore_1.getFirestore)()) {
    const found = new Set();
    const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
    // Firestore caps an `in` filter at 30 values.
    for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30);
        const snap = await db
            .collection(accountPortfolioSummary_js_1.ACCOUNTS_COLLECTION)
            .where("nameLower", "in", chunk.map((n) => (0, accountImportCommand_js_1.normalizeAccountSearchName)(n)))
            .get();
        for (const doc of snap.docs) {
            const name = String((doc.data() ?? {}).name ?? "");
            if (name)
                found.add((0, entityContract_js_1.naturalIdentityKey)(name));
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
function firestoreCustomerWriter(actorUid, db) {
    return {
        async write(draft, idempotencyKey) {
            try {
                const outcome = await (0, accountImportCommand_js_1.createAccountFromImport)({ actorUid, idempotencyKey, accountId: deriveImportedAccountId(String(draft.name ?? "")), draft }, db ? { db } : undefined);
                return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
            }
            catch (err) {
                if (err instanceof accountImportCommand_js_1.AccountImportError) {
                    const message = err.code === "ALREADY_EXISTS"
                        ? "A customer with this name already exists."
                        : err.code === "UNAUTHORIZED"
                            ? "You are not authorized to create customers."
                            : err.code === "GOVERNED_FIELD_REFUSED"
                                ? "This row sets a governed commercial field, which import cannot write."
                                : "The row failed the Customer validation rules.";
                    return { kind: "failed", code: err.code, message };
                }
                if (err instanceof crmWriterState_js_1.FirestoreCrmWriterClosedError) {
                    return { kind: "failed", code: err.code, message: "Customer writes are frozen for the CRM cutover." };
                }
                return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
            }
        },
    };
}
// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
/**
 * Every serial number already registered, normalized the way the contract compares them.
 *
 * READ AND NORMALIZED IN MEMORY rather than queried per row, and that is the point: a legacy
 * machine recorded as "AB 12345" must collide with a file saying "AB12345", and no Firestore
 * query can do that comparison. The command's in-transaction check is the race backstop; THIS
 * is the duplicate detector an operator actually sees, before approving anything.
 *
 * Bounded by the environment's own equipment register, which is why it is acceptable to read
 * it: a customer with more machines than fits in memory has a different problem, and P1
 * imports at most 5000 rows into a sandbox.
 */
async function loadExistingEquipmentSerials(_serials, db = (0, firestore_1.getFirestore)()) {
    const found = new Set();
    const snap = await db.collection(equipmentImportCommand_js_1.EQUIPMENT_COLLECTION).select("serialNumber").get();
    for (const doc of snap.docs) {
        const serial = String((doc.data() ?? {}).serialNumber ?? "").trim();
        // compactIdentityKey, not a local copy of it: this set is compared against keys the
        // EQUIPMENT contract produces, and the two folds must be ONE fold or the duplicate an
        // operator is shown stops being the duplicate the command refuses.
        if (serial)
            found.add((0, entityContract_js_1.compactIdentityKey)(serial));
    }
    return found;
}
/**
 * The customers and locations an equipment file may point at.
 *
 * Returned as KEYS, not ids, because preview only has to answer "does this exist" -- and a
 * preview that carried ids would be carrying resolution the writer has to redo anyway,
 * against state that may have moved. The writer resolves ids for itself, in its transaction.
 *
 * A location's key is its name UNDER ITS CUSTOMER. firestore.rules requires the location to
 * belong to the account, so "Main Street" at some other customer is a different place and
 * must not satisfy this row.
 */
async function loadEquipmentReferences(db = (0, firestore_1.getFirestore)()) {
    const accountsSnap = await db.collection(accountPortfolioSummary_js_1.ACCOUNTS_COLLECTION).select("name").get();
    const nameByAccountId = new Map();
    const customers = new Set();
    for (const doc of accountsSnap.docs) {
        const name = String((doc.data() ?? {}).name ?? "").trim();
        if (!name)
            continue;
        nameByAccountId.set(doc.id, name);
        customers.add((0, entityContract_js_1.naturalIdentityKey)(name));
    }
    const locationsSnap = await db.collection(equipmentImportCommand_js_1.LOCATIONS_COLLECTION).select("name", "accountId").get();
    const locations = new Set();
    for (const doc of locationsSnap.docs) {
        const data = doc.data() ?? {};
        const customerName = nameByAccountId.get(String(data.accountId ?? ""));
        const locationName = String(data.name ?? "").trim();
        // A location whose account is unknown is skipped rather than added under an empty key: an
        // orphaned location must not become a location every customer appears to have.
        if (customerName && locationName)
            locations.add((0, equipmentImportContract_js_1.scopedLocationKey)(customerName, locationName));
    }
    return Object.freeze({
        [equipmentImportContract_js_1.EQUIPMENT_REFERENCES.CUSTOMER]: customers,
        [equipmentImportContract_js_1.EQUIPMENT_REFERENCES.LOCATION]: locations,
    });
}
/**
 * The Equipment writer.
 *
 * It resolves the two names to ids HERE, per row, and hands the command ids -- which the
 * command then re-checks against stored state inside its transaction. Resolving twice is
 * deliberate: the preview's answer is minutes old by the time an admin approves, and a
 * referential rule enforced from a cached answer is not enforced.
 */
function firestoreEquipmentWriter(actorUid, db = (0, firestore_1.getFirestore)()) {
    return {
        async write(draft, idempotencyKey) {
            try {
                const customerName = String(draft.customerName ?? "");
                const locationName = String(draft.locationName ?? "");
                const accountId = await resolveAccountIdByName(db, customerName);
                if (!accountId) {
                    return { kind: "failed", code: "CUSTOMER_NOT_FOUND", message: `No customer named "${customerName}" exists.` };
                }
                const locationId = await resolveLocationIdByName(db, accountId, locationName);
                if (!locationId) {
                    return {
                        kind: "failed",
                        code: "LOCATION_NOT_FOUND",
                        message: `"${customerName}" has no location named "${locationName}".`,
                    };
                }
                // The two name fields are dropped: they were the file's way of naming records, and
                // the stored document holds ids. Leaving them would put a stale copy of a customer's
                // name on every machine, which is the classic way two sources of one fact appear.
                const { customerName: _c, locationName: _l, ...fields } = draft;
                const outcome = await (0, equipmentImportCommand_js_1.createEquipmentFromImport)({ actorUid, idempotencyKey, accountId, locationId, fields }, { db });
                return { kind: outcome.outcome === "replayed" ? "replayed" : "created" };
            }
            catch (err) {
                if (err instanceof equipmentImportCommand_js_1.EquipmentImportError) {
                    const message = err.code === "DUPLICATE_SERIAL"
                        ? "This serial number is already registered to a machine."
                        : err.code === "UNAUTHORIZED"
                            ? "You are not authorized to create equipment."
                            : err.code === "LOCATION_NOT_UNDER_CUSTOMER"
                                ? "That location does not belong to that customer."
                                : "The row failed the Equipment validation rules.";
                    return { kind: "failed", code: err.code, message };
                }
                return { kind: "failed", code: "UNEXPECTED", message: "The record could not be written." };
            }
        },
    };
}
async function resolveAccountIdByName(db, name) {
    const snap = await db
        .collection(accountPortfolioSummary_js_1.ACCOUNTS_COLLECTION)
        .where("nameLower", "==", (0, accountImportCommand_js_1.normalizeAccountSearchName)(name))
        .limit(2)
        .get();
    // TWO customers with one name is not a resolution, it is a question. Picking either would
    // attach a machine to the wrong company on a coin flip.
    if (snap.size !== 1)
        return null;
    return snap.docs[0].id;
}
async function resolveLocationIdByName(db, accountId, name) {
    const snap = await db.collection(equipmentImportCommand_js_1.LOCATIONS_COLLECTION).where("accountId", "==", accountId).get();
    const wanted = (0, entityContract_js_1.naturalIdentityKey)(name);
    const matches = snap.docs.filter((d) => (0, entityContract_js_1.naturalIdentityKey)(String((d.data() ?? {}).name ?? "")) === wanted);
    return matches.length === 1 ? matches[0].id : null;
}
//# sourceMappingURL=firestoreDataImportAdapters.js.map