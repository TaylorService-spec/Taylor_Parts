// Contact CSV import -- the trusted command.
//
// Class C in the write census, and CRUD in the workflow census: a bulk creation of rows, with no
// lifecycle, no approval, no state machine and no governed side effect. It stays CRUD here. Nothing
// about moving the write to the server makes it a workflow, and giving it workflow shape now would
// pre-empt a design decision that belongs to Administration > Workflows.
//
// WHAT MOVED, AND WHAT DID NOT.
//
// Moved: the authority. The browser used to compose a `writeBatch` against `contacts` and assert
// `createdBy`/`updatedBy` from `auth.currentUser`, with firestore.rules' `isAdminOrDispatcher()` as
// the only check. The server now resolves the actor from request.auth.uid and resolves
// `crm.contact.create` fail-closed.
//
// Did NOT move, deliberately:
//   * the batch. Still one atomic commit -- every accepted contact or none. A partial import is the
//     one outcome this surface has always refused, and a failure must persist zero rows.
//   * the row bound. MAX_IMPORT_ROWS (200) is enforced here as well as in the browser, because this
//     is now the sole write path and a bound only the UI applies is not a bound.
//   * validation, duplicate handling and error behaviour. Row-level validation and duplicate
//     detection remain the client's `contactCsvImport.js` -- they are presentation decisions about
//     which rows the person is offered, made against contacts the person is looking at. The server
//     validates what it is asked to WRITE, which is a different question and always was.
//   * `isPrimary: false` on every imported row. Primary is chosen per-contact in the UI; an import
//     never elects one.
//   * the returned shape, `{ ids }`, in document order.
//
// NO AUDIT EVENT, and that is a measured decision rather than an omission. The census records that
// this path writes none. Unlike the reorder commands -- whose idempotency mechanism IS an audit
// document, so they could not exist in that shape without one -- a batch create needs no
// deterministic replay id, so adding an audit event here would be adding one merely because it
// seemed desirable. The census says not to.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";

const CONTACTS = "contacts";

/** Mirrors contactCsvImport.js's MAX_IMPORT_ROWS. Firestore's own batch cap is 500. */
export const MAX_IMPORT_ROWS = 200;

export const CONTACT_CREATE_CAPABILITY = "crm.contact.create";

export class ContactImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ContactImportError";
  }
}

export interface ImportContactRow {
  readonly name?: unknown;
  readonly phone?: unknown;
  readonly email?: unknown;
  readonly role?: unknown;
}

export interface BuiltContact {
  readonly accountId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly role: string | null;
  readonly isPrimary: false;
  readonly createdAt: number;
  readonly createdBy: string;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Build the documents to write. Pure: no Firestore, no clock, no identity of its own.
 *
 * ONE `nowMillis` FOR THE WHOLE IMPORT, taken by the caller. The client stamped a single `now`
 * across every row of a batch and that is worth keeping: rows imported together share a timestamp,
 * so the import is legible afterwards as one act rather than as N arrivals microseconds apart.
 */
export function buildImportedContacts(
  accountId: unknown,
  rows: readonly ImportContactRow[],
  ctx: { actorUid: string; nowMillis: number },
): readonly BuiltContact[] {
  const account = text(accountId);
  if (!account) throw new ContactImportError("ACCOUNT_REQUIRED", "accountId is required");
  if (!Array.isArray(rows)) throw new ContactImportError("INVALID", "contacts must be an array");
  if (rows.length === 0) throw new ContactImportError("NO_ROWS", "There are no contacts to import.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ContactImportError(
      "TOO_MANY_ROWS",
      `An import may contain at most ${MAX_IMPORT_ROWS} contacts; this one has ${rows.length}.`,
    );
  }

  return rows.map((row, i) => {
    // A name is the only field the client's own validation requires, and it is required here too:
    // this is the sole write path, so a row that reached it without one would create a nameless
    // contact that no surface can identify.
    const name = text(row?.name);
    if (!name) throw new ContactImportError("ROW_INVALID", `Row ${i + 1} has no name.`);
    return {
      accountId: account,
      name,
      phone: text(row?.phone),
      email: text(row?.email),
      role: text(row?.role),
      isPrimary: false as const,
      createdAt: ctx.nowMillis,
      createdBy: ctx.actorUid,
      updatedAt: ctx.nowMillis,
      updatedBy: ctx.actorUid,
    };
  });
}

export async function persistImportedContacts(
  db: Firestore,
  accountId: unknown,
  rows: readonly ImportContactRow[],
  actorUid: string,
  nowMillis: number,
): Promise<{ ids: string[] }> {
  const built = buildImportedContacts(accountId, rows, { actorUid, nowMillis });
  const batch = db.batch();
  const ids: string[] = [];
  for (const contact of built) {
    const ref = db.collection(CONTACTS).doc();
    ids.push(ref.id);
    batch.set(ref, contact);
  }
  // ONE COMMIT. Either every accepted contact lands or none does -- the same guarantee the client
  // writeBatch gave, on the same reasoning: a half-finished import leaves a person reconciling a
  // spreadsheet against a partially-populated account with nothing telling them where it stopped.
  await batch.commit();
  return { ids };
}

export const importContacts = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  const actorUid = request.auth.uid;

  // Fail-closed, the same shape reorderCallables.ts's requireCapability uses: a resolver that
  // THROWS is a denial, never an allow. A capability check whose error path lets the write through
  // is worse than no check, because it looks like one.
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({
      principalUid: actorUid,
      permissionIds: [CONTACT_CREATE_CAPABILITY],
    });
    allowed = decisions[CONTACT_CREATE_CAPABILITY] === true;
  } catch (err) {
    console.error(`[contactImport] capability resolution failed for ${CONTACT_CREATE_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", `You are not authorized: ${CONTACT_CREATE_CAPABILITY}`);

  const data = (request.data ?? {}) as { accountId?: unknown; contacts?: unknown };
  try {
    return await persistImportedContacts(
      getFirestore(),
      data.accountId,
      (data.contacts ?? []) as ImportContactRow[],
      actorUid,
      Date.now(),
    );
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof ContactImportError) {
      // A bad payload is invalid-argument. There are no state preconditions here -- an import
      // depends on nothing about the account beyond its id -- so nothing maps to failed-precondition.
      throw new HttpsError("invalid-argument", err.message, { code: err.code });
    }
    throw new HttpsError("internal", "The contact import could not be completed.");
  }
});
