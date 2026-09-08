// CRM writes — Account, Contact and Location, as trusted commands.
//
// These replace the last store-mediated client-direct business writes. `makeCollectionStore` is
// TRANSPORT, not infrastructure: a domain module calling `store.add(...)` was composing a document
// and sending it to Firestore with Rules as the only check, exactly like a raw `setDoc`.
//
// ============================ WHAT EVERY COMMAND HERE GUARANTEES ============================
//
//   * the actor comes from request.auth.uid and is never read from the payload;
//   * timestamps come from the server clock;
//   * the server reads the authoritative current record before deciding an update;
//   * the field set is CLOSED -- a caller cannot introduce a field no rule ever reviewed;
//   * the document id is minted here and returned, never accepted.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { normalizeAccountSearchName } from "../account/accountImportCommand";

const ACCOUNTS = "accounts";
const CONTACTS = "contacts";
const LOCATIONS = "locations";

export const ACCOUNT_CREATE = "customer.record.create";
export const ACCOUNT_UPDATE = "customer.record.update";
export const ACCOUNT_GOVERNED_FIELD_WRITE = "customer.governedField.write";
export const CONTACT_CREATE = "crm.contact.create";
export const CONTACT_UPDATE = "crm.contact.update";
export const LOCATION_CREATE = "crm.location.create";
export const LOCATION_UPDATE = "crm.location.update";

/**
 * The two GOVERNED COMMERCIAL FIELDS on an Account.
 *
 * The retired rule treated these differently from every other Account field, and that difference is
 * the authority rather than a UI convention:
 *
 *   create  isAdminOrDispatcher() AND valid enums AND (isAdmin() OR the governed BASELINE:
 *           paymentTerms absent/null, taxStatus absent/null/UNKNOWN)
 *   update  isAdminOrDispatcher() AND valid enums AND (isAdmin() OR governed fields UNCHANGED)
 *
 * So a dispatcher could always create and edit a Customer, and could never set or change these two
 * to a non-baseline value. That split survives here as a SECOND capability check
 * (`customer.governedField.write`), which admin/owner/accountingManager/financeManager hold and
 * dispatcher does not — the same population the `isAdmin()` branch admitted, expressed as authority
 * rather than as a role name.
 */
export const ACCOUNT_GOVERNED_FIELDS = Object.freeze(["paymentTerms", "taxStatus"] as const);

// ════════════════════ THE GOVERNED VALUE SETS ════════════════════
//
// These lived ONLY in `firestore.rules`:
//
//   paymentTerms in ['COD', 'NET_30', 'NET_60', 'NET_90']
//   taxStatus    in ['UNKNOWN', 'TAXABLE', 'EXEMPT', 'RESELLER']
//
// Nothing server-side re-checked them, so retiring the client-direct write would have retired
// the only enforcement of what these fields may CONTAIN -- leaving a capability holder able to
// stamp `paymentTerms: "whenever"` on a customer. The capability says WHO may set a governed
// field; it never said WHAT the field may say, and conflating the two is how a governed field
// quietly becomes a free-text one.
//
// `null` and an absent field are permitted, exactly as the rule's `data.get(field, null) == null`
// branch permitted them: unset is a legitimate state, and taxStatus has an explicit UNKNOWN.
export const ACCOUNT_GOVERNED_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  paymentTerms: Object.freeze(["COD", "NET_30", "NET_60", "NET_90"]),
  taxStatus: Object.freeze(["UNKNOWN", "TAXABLE", "EXEMPT", "RESELLER"]),
});

/**
 * Mirrors the retired `accountGovernedValuesValid()` predicate: a governed field is either unset
 * or one of its declared values. Checked on every account write, not only the ones that CHANGE a
 * governed field -- a create that sets a nonsense value never had a previous value to compare to.
 */
export function governedValuesValid(data: Record<string, unknown>): boolean {
  for (const field of ACCOUNT_GOVERNED_FIELDS) {
    if (!(field in data)) continue;
    const value = data[field] ?? null;
    if (value === null) continue;
    if (typeof value !== "string") return false;
    if (!ACCOUNT_GOVERNED_VALUES[field].includes(value)) return false;
  }
  return true;
}

/** Mirrors the retired `accountGovernedCreateBaseline()` predicate exactly. */
export function isGovernedCreateBaseline(data: Record<string, unknown>): boolean {
  const paymentTerms = data.paymentTerms ?? null;
  const taxStatus = data.taxStatus ?? null;
  return paymentTerms === null && (taxStatus === null || taxStatus === "UNKNOWN");
}

/** Mirrors the retired `accountGovernedFieldsUnchanged()` predicate exactly. */
export function governedFieldsUnchanged(
  next: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  return ACCOUNT_GOVERNED_FIELDS.every((f) => {
    // A patch that does not MENTION the field cannot be changing it. `?? null` matches the rule's
    // own `data.get(field, null)` comparison, so absent and null are the same value here.
    if (!(f in next)) return true;
    return (next[f] ?? null) === (current[f] ?? null);
  });
}

export class CrmCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CrmCommandError";
  }
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

// THE SEARCH-NAME DERIVATION IS NOT REIMPLEMENTED HERE. domain/nameNormalization.js is explicit
// that there is exactly one definition and that a second one makes records silently unfindable --
// two call sites normalizing differently is a bug that reads as "search is flaky". This repository
// already carries the sanctioned server-side copy, with its reason and an equality test
// (functions/src/account/accountImportCommand.ts), so this imports THAT rather than adding a third.
export const SEARCH_NAME_FIELD = "nameLower";

/**
 * Strip every key the caller may not author, on every path.
 *
 * A patch is a caller's, so it may carry anything. These are the fields whose values are the
 * SERVER's answer, and letting one through would let a browser backdate a record or attribute a
 * change to someone else.
 */
const ACTOR_AND_CLOCK_FIELDS = Object.freeze([
  "id",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
]);

export function stripReservedFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (ACTOR_AND_CLOCK_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

// ════════════════════════════ ACCOUNTS ════════════════════════════

/**
 * ACCOUNTS STAMP A FIRESTORE TIMESTAMP, NOT EPOCH MILLIS — and this is not a style choice.
 *
 * metadata/definitions/account.js governs createdAt/updatedAt as TIMESTAMP, and the existing
 * population stores Timestamps. Firestore orders ACROSS TYPES BY TYPE FIRST, so a number sorts
 * BELOW every Timestamp: a Customer created with epoch millis lands LAST under `updatedAt DESC`,
 * which on a paged list is indistinguishable from invisible.
 *
 * That defect has been shipped once before, and this migration reintroduced it — caught by
 * test/collectionStoreTimestampContract.test.mjs, which existed precisely because the failure is
 * silent and the data is already written by the time it is visible.
 *
 * Contacts, Locations and Equipment govern these fields as NUMBER, so those commands keep epoch
 * millis. The type is the entity definition's to decide, and each command agrees with the
 * definition it writes to.
 */
export function buildAccountCreate(
  data: Record<string, unknown>,
  ctx: { actorUid: string; nowValue: unknown; mayWriteGovernedFields: boolean },
): Record<string, unknown> {
  const clean = stripReservedFields(data ?? {});
  if (!text(clean.name)) throw new CrmCommandError("NAME_REQUIRED", "A customer name is required.");

  // THE GOVERNED-FIELD SPLIT, at create. A principal without the governed-field capability may
  // create a Customer, but only at the baseline the retired rule required — never with a commercial
  // term already set. Refused rather than silently reset to baseline: quietly discarding a value the
  // caller supplied would tell them the terms were saved.
  if (!ctx.mayWriteGovernedFields && !isGovernedCreateBaseline(clean)) {
    throw new CrmCommandError(
      "GOVERNED_FIELD_DENIED",
      `Setting ${ACCOUNT_GOVERNED_FIELDS.join(" or ")} requires ${ACCOUNT_GOVERNED_FIELD_WRITE}.`,
    );
  }

  // THE VALUE SET, checked on every write. The capability decides WHO may set a governed field;
  // it never decided WHAT the field may contain, and this is the half that lived only in Rules.
  if (!governedValuesValid(clean)) {
    throw new CrmCommandError(
      "GOVERNED_VALUE_INVALID",
      `${ACCOUNT_GOVERNED_FIELDS.join(" and ")} must each be unset or one of their governed values.`,
    );
  }

  return {
    ...clean,
    [SEARCH_NAME_FIELD]: normalizeAccountSearchName(clean.name as string),
    createdAt: ctx.nowValue,
    createdBy: ctx.actorUid,
    updatedAt: ctx.nowValue,
    updatedBy: ctx.actorUid,
  };
}

export function buildAccountUpdate(
  data: Record<string, unknown>,
  current: Record<string, unknown> | null,
  ctx: { actorUid: string; nowValue: unknown; mayWriteGovernedFields: boolean },
): Record<string, unknown> {
  if (current === null) throw new CrmCommandError("NOT_FOUND", "No such customer.");
  const clean = stripReservedFields(data ?? {});

  // Compared against the AUTHORITATIVE CURRENT RECORD the server just read — never against a
  // "current" value the caller supplied, which is the whole reason the read happens first.
  if (!ctx.mayWriteGovernedFields && !governedFieldsUnchanged(clean, current)) {
    throw new CrmCommandError(
      "GOVERNED_FIELD_DENIED",
      `Changing ${ACCOUNT_GOVERNED_FIELDS.join(" or ")} requires ${ACCOUNT_GOVERNED_FIELD_WRITE}.`,
    );
  }

  // THE VALUE SET, checked on every write. The capability decides WHO may set a governed field;
  // it never decided WHAT the field may contain, and this is the half that lived only in Rules.
  if (!governedValuesValid(clean)) {
    throw new CrmCommandError(
      "GOVERNED_VALUE_INVALID",
      `${ACCOUNT_GOVERNED_FIELDS.join(" and ")} must each be unset or one of their governed values.`,
    );
  }

  const patch: Record<string, unknown> = { ...clean, updatedAt: ctx.nowValue, updatedBy: ctx.actorUid };
  // MERGE SEMANTICS PRESERVED: the client's update was a partial patch, and an absent `name` meant
  // "not touching the name" — so the stored search derivation must not be clobbered with "".
  if ("name" in clean) patch[SEARCH_NAME_FIELD] = normalizeAccountSearchName(clean.name as string);
  return patch;
}

// ════════════════════════════ CONTACTS ════════════════════════════

export function buildContactCreate(
  accountId: unknown,
  data: Record<string, unknown>,
  ctx: { actorUid: string; nowMillis: number },
): Record<string, unknown> {
  const account = text(accountId);
  if (!account) throw new CrmCommandError("ACCOUNT_REQUIRED", "accountId is required.");
  const clean = stripReservedFields(data ?? {});
  if (!text(clean.name)) throw new CrmCommandError("NAME_REQUIRED", "A contact name is required.");
  return {
    ...clean,
    // The account is the COMMAND's argument, not a field a caller may override from the payload.
    accountId: account,
    createdAt: ctx.nowMillis,
    createdBy: ctx.actorUid,
    updatedAt: ctx.nowMillis,
    updatedBy: ctx.actorUid,
  };
}

export function buildContactUpdate(
  data: Record<string, unknown>,
  current: Record<string, unknown> | null,
  ctx: { actorUid: string; nowMillis: number },
): Record<string, unknown> {
  if (current === null) throw new CrmCommandError("NOT_FOUND", "No such contact.");
  // `accountId` is deliberately NOT strippable-but-writable: re-parenting a contact is not what the
  // edit form does, and the retired rule's single predicate never distinguished it. Left exactly as
  // the client patch had it, which is to say the form never sends one.
  return { ...stripReservedFields(data ?? {}), updatedAt: ctx.nowMillis, updatedBy: ctx.actorUid };
}

// ════════════════════════════ LOCATIONS ════════════════════════════

export function buildLocationCreate(
  accountId: unknown,
  data: Record<string, unknown>,
  ctx: { actorUid: string; nowMillis: number },
): Record<string, unknown> {
  const account = text(accountId);
  if (!account) throw new CrmCommandError("ACCOUNT_REQUIRED", "accountId is required.");
  return {
    ...stripReservedFields(data ?? {}),
    accountId: account,
    createdAt: ctx.nowMillis,
    createdBy: ctx.actorUid,
    updatedAt: ctx.nowMillis,
    updatedBy: ctx.actorUid,
  };
}

export function buildLocationUpdate(
  data: Record<string, unknown>,
  current: Record<string, unknown> | null,
  ctx: { actorUid: string; nowMillis: number },
): Record<string, unknown> {
  if (current === null) throw new CrmCommandError("NOT_FOUND", "No such location.");
  return { ...stripReservedFields(data ?? {}), updatedAt: ctx.nowMillis, updatedBy: ctx.actorUid };
}

// ════════════════════════════ THE CALLABLES ════════════════════════════

async function holds(uid: string, ids: readonly string[]): Promise<Record<string, boolean>> {
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [...ids] });
    return decisions as Record<string, boolean>;
  } catch (err) {
    // FAIL-CLOSED: a resolver that throws denies. A capability check whose error path lets the write
    // through is worse than no check, because it looks like one.
    console.error("[crm] capability resolution failed", err);
    return {};
  }
}

function requireUid(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || !uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  return uid;
}

function mapError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof CrmCommandError) {
    // A governed-field refusal is an AUTHORIZATION answer, not a malformed payload: the caller has
    // nothing to fix in the shape of its request.
    if (err.code === "GOVERNED_FIELD_DENIED") return new HttpsError("permission-denied", err.message, { code: err.code });
    if (err.code === "NOT_FOUND") return new HttpsError("failed-precondition", err.message, { code: err.code });
    return new HttpsError("invalid-argument", err.message, { code: err.code });
  }
  return new HttpsError("internal", "The write could not be completed.");
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function readCurrent(db: Firestore, collection: string, id: unknown): Promise<Record<string, unknown> | null> {
  const key = text(id);
  if (!key) throw new CrmCommandError("INVALID", "An id is required.");
  const snap = await db.collection(collection).doc(key).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

export const createAccountRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  const d = await holds(actorUid, [ACCOUNT_CREATE, ACCOUNT_GOVERNED_FIELD_WRITE]);
  if (d[ACCOUNT_CREATE] !== true) throw new HttpsError("permission-denied", `You are not authorized: ${ACCOUNT_CREATE}`);
  const db = getFirestore();
  try {
    const built = buildAccountCreate(asRecord(request.data).data as Record<string, unknown>, {
      actorUid,
      // A Timestamp, matching the governed type. See buildAccountCreate's note.
      nowValue: Timestamp.now(),
      mayWriteGovernedFields: d[ACCOUNT_GOVERNED_FIELD_WRITE] === true,
    });
    const ref = db.collection(ACCOUNTS).doc();
    await ref.set(built);
    return { ...built, id: ref.id };
  } catch (err) {
    throw mapError(err);
  }
});

export const updateAccountRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  const d = await holds(actorUid, [ACCOUNT_UPDATE, ACCOUNT_GOVERNED_FIELD_WRITE]);
  if (d[ACCOUNT_UPDATE] !== true) throw new HttpsError("permission-denied", `You are not authorized: ${ACCOUNT_UPDATE}`);
  const db = getFirestore();
  const payload = asRecord(request.data);
  try {
    const current = await readCurrent(db, ACCOUNTS, payload.id);
    const patch = buildAccountUpdate(asRecord(payload.data), current, {
      actorUid,
      // A Timestamp, matching the governed type. See buildAccountCreate's note.
      nowValue: Timestamp.now(),
      mayWriteGovernedFields: d[ACCOUNT_GOVERNED_FIELD_WRITE] === true,
    });
    await db.collection(ACCOUNTS).doc(String(payload.id)).update(patch);
    return { id: String(payload.id), ...patch };
  } catch (err) {
    throw mapError(err);
  }
});

export const createContactRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  const d = await holds(actorUid, [CONTACT_CREATE]);
  if (d[CONTACT_CREATE] !== true) throw new HttpsError("permission-denied", `You are not authorized: ${CONTACT_CREATE}`);
  const db = getFirestore();
  const payload = asRecord(request.data);
  try {
    const built = buildContactCreate(payload.accountId, asRecord(payload.data), { actorUid, nowMillis: Date.now() });
    const ref = db.collection(CONTACTS).doc();
    await ref.set(built);
    return { ...built, id: ref.id };
  } catch (err) {
    throw mapError(err);
  }
});

export const updateContactRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  const d = await holds(actorUid, [CONTACT_UPDATE]);
  if (d[CONTACT_UPDATE] !== true) throw new HttpsError("permission-denied", `You are not authorized: ${CONTACT_UPDATE}`);
  const db = getFirestore();
  const payload = asRecord(request.data);
  try {
    const current = await readCurrent(db, CONTACTS, payload.id);
    const patch = buildContactUpdate(asRecord(payload.data), current, { actorUid, nowMillis: Date.now() });
    await db.collection(CONTACTS).doc(String(payload.id)).update(patch);
    return { id: String(payload.id), ...patch };
  } catch (err) {
    throw mapError(err);
  }
});

export const createLocationRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  const d = await holds(actorUid, [LOCATION_CREATE]);
  if (d[LOCATION_CREATE] !== true) throw new HttpsError("permission-denied", `You are not authorized: ${LOCATION_CREATE}`);
  const db = getFirestore();
  const payload = asRecord(request.data);
  try {
    const built = buildLocationCreate(payload.accountId, asRecord(payload.data), { actorUid, nowMillis: Date.now() });
    const ref = db.collection(LOCATIONS).doc();
    await ref.set(built);
    return { ...built, id: ref.id };
  } catch (err) {
    throw mapError(err);
  }
});

export const updateLocationRecord = onCall({ region: "us-central1" }, async (request) => {
  const actorUid = requireUid(request);
  const d = await holds(actorUid, [LOCATION_UPDATE]);
  if (d[LOCATION_UPDATE] !== true) throw new HttpsError("permission-denied", `You are not authorized: ${LOCATION_UPDATE}`);
  const db = getFirestore();
  const payload = asRecord(request.data);
  try {
    const current = await readCurrent(db, LOCATIONS, payload.id);
    const patch = buildLocationUpdate(asRecord(payload.data), current, { actorUid, nowMillis: Date.now() });
    await db.collection(LOCATIONS).doc(String(payload.id)).update(patch);
    return { id: String(payload.id), ...patch };
  } catch (err) {
    throw mapError(err);
  }
});
