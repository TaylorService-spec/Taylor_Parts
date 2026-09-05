// ADMINISTRATION USERS CONSOLIDATION -- the trusted Employee PROFILE writer.
//
// ════════════════════ WHY A COMMAND EXISTS AT ALL ════════════════════
//
// firestore.rules' employees/{employeeId} block is `allow create, update, delete: if false`.
// Until now the collection's only writer was functions/scripts/provisionEmployeeAccess.js, an
// operator script running under the Admin SDK. That is correct for onboarding and useless for
// "somebody was promoted": an administrator cannot run an operator script to fix a job title.
//
// So Administration -> Users -> Edit User needed a write path, and the two options were widening
// Rules to let the client write employee documents, or a trusted command. Rules stay exactly as
// they are; this is the command. Nothing in the client can write this collection, before or after.
//
// ════════════════════ WHAT IT REFUSES, AND WHY THAT IS THE POINT ════════════════════
//
// The editable set below is PROFILE AND EMPLOYMENT ONLY. Three fields are structurally
// unreachable through this command, and each refusal is a product invariant, not a precaution:
//
//   securityRole  -- a denormalized, read-only mirror of users/{uid}.role (BusinessEntityModel
//                    Section 8a). Writing the mirror does not change what anyone can do; it makes
//                    the directory disagree with the access model while looking authoritative.
//                    Security role changes belong to the governed Role commands (grantRole /
//                    assignApprovedRole), which write the authority and let the mirror follow.
//   userId        -- the governed Employee<->User linkage, written only by the reciprocal
//                    two-way provisioning path. A one-sided write here would produce exactly the
//                    non-reciprocal linkage adminCredentialCommands' resolveEmployeeLinkFacts
//                    exists to detect.
//   account status-- enable/disable is Firebase Auth state owned by setUserStatus
//                    (trustedWriterCommands.ts), which also bumps accessVersion and resyncs
//                    claims. There is no employee-document representation of it to write.
//
// Employment Status IS editable here and account status is NOT, and that is deliberate: they are
// independent facts (a CONTRACTOR may hold access; a TERMINATED employee's account is disabled by
// a separate, audited act). Terminating employment through this command switches nobody off, and
// this file contains no code that could.
//
// ════════════════════ ONE AUDIT EVENT PER CHANGED FIELD ════════════════════
//
// A save that changes three fields writes three Audit Events, each carrying fieldKey /
// previousValue / newValue, all in the SAME transaction as the document write. Not one bundled
// event: "when did this person's manager change" is the question the record's Change History
// answers, and a bundled event cannot be filtered or sorted by field. Not a second collection
// either -- these are ordinary Audit Events on the existing immutable trail (auditEventWriter.ts's
// FIELD_CHANGE_ACTIONS), so the canonical audit authority stays the canonical audit authority and
// Change History is a projection of it.
//
// A save that changes NOTHING writes nothing and returns `unchanged`. An audit trail whose entries
// include "changed jobTitle from X to X" is a trail nobody can read.
//
// ════════════════════ IDEMPOTENCY ════════════════════
//
// Deterministic on the caller's idempotencyKey, exactly like trustedWriterCommands': the FIRST
// field event's document id IS the key, so a retry finds it inside the transaction and returns
// `replayed` without writing again. A different payload under the same key is a conflict, not a
// silent overwrite.
import { getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { AuditAction, Role } from "../types/access";
import { resolveEffectivePermission, type TargetContext } from "./resolveEffectivePermission";
import { COMPATIBILITY_ROLES } from "./compatibilityRoles";
import {
  auditEventDocRef,
  recordStandaloneAuditEvent,
  stageAuditEventWithId,
} from "./auditEventWriter";

const USERS_COLLECTION = "users";
const ROLE_ASSIGNMENTS_COLLECTION = "roleAssignments";
const EMPLOYEES_COLLECTION = "employees";

// ════════════════════ THE EMPLOYEE-NUMBER UNIQUENESS REGISTRY ════════════════════
//
// One document per claimed employee number, keyed by the NORMALIZED number, holding the employeeId
// that owns it. Claiming, releasing and checking all happen inside the SAME transaction as the
// profile write, so two administrators typing "TAZ-0042" at once produce one winner and one refusal
// rather than two employees sharing a business identifier.
//
// WHY A REGISTRY AND NOT A QUERY. The obvious alternative -- query `employees` for the number
// inside the transaction and refuse if anyone else holds it -- does not actually hold: Firestore's
// transactional isolation covers the documents a query MATCHED, not the ones that did not exist
// when it ran, so two concurrent claims of an unused number both see "nobody has it". A document id
// has no phantom: a read of `employee_number_registry/TAZ-0042` locks that exact key whether it
// exists or not, which is the guarantee uniqueness needs.
//
// NO RULES CHANGE. No match block names this collection, so firestore.rules denies every client
// read and write of it by default -- the same posture `privilegedRoleRequests` deliberately takes.
// The Admin SDK is the only writer, and this command is the only Admin-SDK path to it.
//
// NOTHING TO BACKFILL. `employeeNumber` is introduced by this same change and no document has ever
// carried one, so the registry starts empty and consistent by construction rather than by a
// migration somebody has to trust.
const EMPLOYEE_NUMBER_REGISTRY_COLLECTION = "employee_number_registry";

/** The target type every Employee-profile Audit Event carries. Change History queries by it. */
export const EMPLOYEE_TARGET_TYPE = "employee";

export const EMPLOYEE_PROFILE_CAPABILITY = "admin.employeeProfile.write";
const UPDATE_ACTION: AuditAction = "updateEmployeeProfile";

export class InvalidInputError extends Error {}
export class UnauthorizedActorError extends Error {}
export class EmployeeNotFoundError extends Error {}
export class UnknownManagerError extends Error {}
export class IdempotencyKeyConflictError extends Error {}
export class EmployeeNumberTakenError extends Error {}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,200}$/;
const MAX_TEXT_LENGTH = 200;

// ════════════════════ THE VOCABULARIES, MIRRORED IN PROSE ════════════════════
//
// functions/scripts/provisionEmployeeAccess.js is the collection's other writer and holds the
// same two closed sets. It is a plain .js operator script in this same package, but importing it
// would pull its Admin-SDK bootstrap and CLI argument parsing into the deployed bundle, so the
// values are mirrored here by literal -- the same boundary salesOrder's SALES_CHANNELS mirror
// crosses in prose. functions/test/employeeProfileCommands.test.mjs asserts the two lists match,
// so the mirror cannot drift silently.
export const EMPLOYMENT_STATUS_VALUES = Object.freeze([
  "ACTIVE",
  "ON_LEAVE",
  "INACTIVE",
  "TERMINATED",
  "RETIRED",
  "CONTRACTOR",
]);

export const OPERATIONAL_ROLE_VALUES = Object.freeze([
  "PARTS_MANAGER",
  "PARTS_ASSOCIATE",
  "TECHNICIAN",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_ASSOCIATE",
  "SERVICE_MANAGER",
  "SALES_MANAGER",
  "SALES_ASSOCIATE",
]);

// The governed operating companies (domain/operatingCompanyAuthority.js and its Functions mirror).
// SHAPE-checked rather than membership-checked, for the reason that authority gives: the ruling
// requires additional companies to be addable without a schema change, so a well-formed unknown id
// is a different answer from a malformed one.
const OPERATING_COMPANY_ID_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;

// A BUSINESS EMPLOYEE NUMBER IS A CODE, not free text -- it is quoted on the phone, typed into a
// search box and printed on paper, and it is about to become a uniqueness key. So it is bounded and
// shaped: letters, digits, dot, underscore and hyphen, starting with an alphanumeric. Deliberately
// NO spaces and NO slash -- a slash cannot appear in a Firestore document id, and " TAZ 42" vs
// "TAZ 42" is the kind of near-duplicate a uniqueness rule exists to prevent rather than record.
//
// The pattern is permissive about SCHEME (TAZ-0042, 100234 and E.42 are all fine) because the
// numbering scheme is Taylor's to choose and this file must not invent one.
const EMPLOYEE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

// Uniqueness is CASE-INSENSITIVE. "taz-0042" and "TAZ-0042" are one employee number written two
// ways, and letting both exist would defeat the rule while appearing to satisfy it. The stored
// value keeps the case an administrator typed; only the registry key is folded.
export function normalizeEmployeeNumberKey(value: string): string {
  return value.toUpperCase();
}

// A date a person types about employment: a calendar day, not an instant. Stored as the ISO
// calendar string rather than a timestamp because "hired on the 3rd" is not a moment and giving it
// one invents a timezone the record never had.
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Deliberately permissive: a name, a phone number and a street address take more forms across
// people and countries than any pattern this file could honestly assert. The bound and the
// trim are real; a "valid name" regex is not.
type FieldKind =
  | "TEXT"
  | "EMAIL"
  | "DATE"
  | "EMPLOYMENT_STATUS"
  | "OPERATIONAL_ROLES"
  | "OPERATING_COMPANY"
  | "MANAGER"
  | "EMPLOYEE_NUMBER";

interface EditableField {
  readonly key: string;
  readonly kind: FieldKind;
}

/**
 * Every field this command will write, and nothing else.
 *
 * An input key absent from this list is REJECTED rather than ignored -- a caller submitting
 * `securityRole` gets an error naming it, not a silent no-op that leaves them believing the change
 * landed. That distinction is the whole reason the refusals above are enforceable.
 *
 * `address` is nested, and its five sub-keys are listed individually (address.street, ...) so a
 * change to a city is a change to a city in the trail rather than an opaque object diff.
 */
export const EDITABLE_EMPLOYEE_FIELDS: readonly EditableField[] = Object.freeze([
  { key: "displayName", kind: "TEXT" },
  { key: "firstName", kind: "TEXT" },
  { key: "middleName", kind: "TEXT" },
  { key: "lastName", kind: "TEXT" },
  { key: "preferredName", kind: "TEXT" },
  { key: "employeeNumber", kind: "EMPLOYEE_NUMBER" },
  { key: "workEmail", kind: "EMAIL" },
  { key: "workPhone", kind: "TEXT" },
  { key: "mobilePhone", kind: "TEXT" },
  { key: "address.street", kind: "TEXT" },
  { key: "address.unit", kind: "TEXT" },
  { key: "address.city", kind: "TEXT" },
  { key: "address.state", kind: "TEXT" },
  { key: "address.postalCode", kind: "TEXT" },
  { key: "jobTitle", kind: "TEXT" },
  { key: "managerEmployeeId", kind: "MANAGER" },
  { key: "operatingCompanyId", kind: "OPERATING_COMPANY" },
  { key: "hireDate", kind: "DATE" },
  { key: "separationDate", kind: "DATE" },
  { key: "employmentStatus", kind: "EMPLOYMENT_STATUS" },
  { key: "operationalRoles", kind: "OPERATIONAL_ROLES" },
] as const);

const FIELD_BY_KEY = new Map(EDITABLE_EMPLOYEE_FIELDS.map((f) => [f.key, f]));

/** Fields this command refuses BY NAME, so the refusal is a message rather than a mystery. */
const REFUSED_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  securityRole:
    "securityRole is a read-only mirror of the governed Role; change it through the Role assignment commands, never here",
  role: "role is application-access identity (users/{uid}), not an Employee profile field",
  userId: "userId is the governed Employee-User linkage and is written only by the provisioning path",
  employeeId: "employeeId is the immutable document identifier",
  accessVersion: "accessVersion is owned by the access commands",
  accountStatus: "account enable/disable is owned by the setUserStatus command",
  disabled: "account enable/disable is owned by the setUserStatus command",
});

export interface UpdateEmployeeProfileInput {
  actorUid: string;
  employeeId: string;
  /** Field key -> new value. Keys are EDITABLE_EMPLOYEE_FIELDS keys, dotted for address. */
  changes: Record<string, unknown>;
  idempotencyKey: string;
}

// NO `reason` PARAMETER, DELIBERATELY. A per-change note is a real thing to want, and the Audit
// Event contract has no field that can carry one for a field-change action -- `handoffReason` is
// closed to OWNERSHIP_HANDOFF, and `summary` is a generated sentence rather than a place to put
// user text past a weaker guard. Widening the immutable trail's contract to add free-text notes is
// a governance change, not a side effect of an edit form, so the shared Change History component
// renders its optional Reason column empty for this record type until that contract exists.

export interface UpdateEmployeeProfileOutcome {
  status: "applied" | "unchanged" | "replayed";
  /** The field keys that actually changed, in the order their Audit Events were written. */
  changedFields: string[];
  auditEventIds: string[];
}

export interface EmployeeProfileDeps {
  db?: Firestore;
  roles?: Readonly<Record<string, Role>>;
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${name} is required`);
  }
}

/**
 * A trimmed string, or null.
 *
 * "" and "   " normalize to null on purpose: a cleared text input means "this is not recorded",
 * and storing an empty string would make an absent value and a blank value two different states
 * that render identically. Absence has exactly one representation in this collection.
 */
function normalizeText(value: unknown, key: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new InvalidInputError(`${key} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new InvalidInputError(`${key} exceeds ${MAX_TEXT_LENGTH} characters`);
  }
  return trimmed;
}

// Structural only: it has an @, something before it and a dotted something after. Deliberately not
// a full address grammar -- a stricter pattern rejects real addresses, and this value is not used
// to authenticate anybody. Delivery is proven by delivery, never by a regex.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeValue(field: EditableField, raw: unknown): unknown {
  switch (field.kind) {
    case "TEXT":
      return normalizeText(raw, field.key);
    case "EMAIL": {
      const text = normalizeText(raw, field.key);
      if (text !== null && !EMAIL_SHAPE.test(text)) {
        throw new InvalidInputError(`${field.key} is not a valid email address`);
      }
      return text;
    }
    case "DATE": {
      const text = normalizeText(raw, field.key);
      if (text !== null && !CALENDAR_DATE_PATTERN.test(text)) {
        throw new InvalidInputError(`${field.key} must be a calendar date (YYYY-MM-DD)`);
      }
      return text;
    }
    case "EMPLOYMENT_STATUS": {
      const text = normalizeText(raw, field.key);
      // NOT nullable: every Employee has a lifecycle state, and this schema has no "unknown"
      // member. Clearing it would leave a record no eligibility query can classify.
      if (text === null) throw new InvalidInputError("employmentStatus is required");
      if (!EMPLOYMENT_STATUS_VALUES.includes(text)) {
        throw new InvalidInputError(
          `employmentStatus must be one of: ${EMPLOYMENT_STATUS_VALUES.join(", ")}`,
        );
      }
      return text;
    }
    case "OPERATIONAL_ROLES": {
      if (!Array.isArray(raw)) throw new InvalidInputError("operationalRoles must be an array");
      const seen = new Set<string>();
      for (const entry of raw) {
        if (typeof entry !== "string" || !OPERATIONAL_ROLE_VALUES.includes(entry)) {
          throw new InvalidInputError(
            `operationalRoles entries must be one of: ${OPERATIONAL_ROLE_VALUES.join(", ")}`,
          );
        }
        seen.add(entry);
      }
      // Stored in the declared vocabulary order rather than the order the form happened to
      // produce, so a reordering is never mistaken for a change.
      return OPERATIONAL_ROLE_VALUES.filter((r) => seen.has(r));
    }
    case "OPERATING_COMPANY": {
      const text = normalizeText(raw, field.key);
      if (text !== null && !OPERATING_COMPANY_ID_PATTERN.test(text)) {
        throw new InvalidInputError("operatingCompanyId is not a well-formed operating-company id");
      }
      return text;
    }
    case "EMPLOYEE_NUMBER": {
      const text = normalizeText(raw, field.key);
      // Clearable: an employee number wrongly assigned must be removable, and clearing it releases
      // the registry claim. Uniqueness is checked inside the transaction -- shape only here.
      if (text !== null && !EMPLOYEE_NUMBER_PATTERN.test(text)) {
        throw new InvalidInputError(
          "employeeNumber must be 1-32 characters of letters, digits, dot, underscore or hyphen, starting with a letter or digit",
        );
      }
      return text;
    }
    case "MANAGER":
      // Existence is checked inside the transaction -- see below. Shape only here.
      return normalizeText(raw, field.key);
    default:
      throw new InvalidInputError(`${field.key} has no validator`);
  }
}

/** The value at a possibly-dotted key. */
function readAt(doc: Record<string, unknown>, key: string): unknown {
  if (!key.includes(".")) return doc[key];
  const [head, tail] = key.split(".");
  const nested = doc[head];
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>)[tail] : undefined;
}

/**
 * Two stored values, compared as this collection stores them.
 *
 * `undefined` (the field was never written) and `null` (it was written as absent) are the SAME
 * absence for comparison purposes -- otherwise the first save of any new profile field on an old
 * record would report a change from "nothing" to "nothing".
 */
function sameValue(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((v, i) => v === right[i]);
  }
  return left === right;
}

/**
 * The trail's rendering of a value.
 *
 * An array becomes a comma-joined list, absence becomes null. NOT JSON: the Audit Event carries
 * what a person reads in the Change History table, and `["TECHNICIAN"]` is not that.
 */
function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.join(", ");
  return String(value);
}

const GLOBAL_TARGET: TargetContext = { scope: { type: "global" }, condition: {} };

function readAccessVersion(data: Record<string, unknown> | undefined): number {
  const raw = data?.accessVersion;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

async function actorHasCapability(
  db: Firestore,
  roles: Readonly<Record<string, Role>>,
  actorUid: string,
): Promise<boolean> {
  const [userSnap, assignmentsSnap] = await Promise.all([
    db.collection(USERS_COLLECTION).doc(actorUid).get(),
    db
      .collection(ROLE_ASSIGNMENTS_COLLECTION)
      .where("principalUid", "==", actorUid)
      .where("status", "==", "active")
      .get(),
  ]);
  return (
    resolveEffectivePermission({
      permissionId: EMPLOYEE_PROFILE_CAPABILITY,
      assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as never[],
      roles,
      currentAccessVersion: readAccessVersion(userSnap.data() as Record<string, unknown> | undefined),
      target: GLOBAL_TARGET,
    }).decision === "ALLOW"
  );
}

/** The deterministic Audit Event id for the nth field event of one save. */
function fieldEventId(idempotencyKey: string, index: number): string {
  return index === 0 ? idempotencyKey : `${idempotencyKey}-${index}`;
}

/**
 * Edit an Employee's profile and employment record.
 *
 * Server-side authorization is re-resolved here on every call: the client's own capability
 * previewer decides what to RENDER and decides nothing about what may be written.
 */
export async function updateEmployeeProfile(
  input: UpdateEmployeeProfileInput,
  deps: EmployeeProfileDeps = {},
): Promise<UpdateEmployeeProfileOutcome> {
  const db = deps.db ?? getFirestore();
  const roles = deps.roles ?? COMPATIBILITY_ROLES;

  assertNonEmptyString(input.actorUid, "actorUid");
  assertNonEmptyString(input.employeeId, "employeeId");
  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new InvalidInputError("idempotencyKey must match [A-Za-z0-9_-]{8,200}");
  }
  if (input.changes === null || typeof input.changes !== "object" || Array.isArray(input.changes)) {
    throw new InvalidInputError("changes must be an object");
  }
  // Validate and normalize BEFORE authorizing, so a malformed request is a malformed request
  // rather than an authorization event -- the same D-PRE3-VALIDATION rule the reset command
  // follows ("validation: NOT audited").
  const submitted = new Map<string, unknown>();
  for (const [key, raw] of Object.entries(input.changes)) {
    const refusal = REFUSED_FIELDS[key];
    if (refusal) throw new InvalidInputError(`${key} cannot be changed here -- ${refusal}`);
    const field = FIELD_BY_KEY.get(key);
    if (!field) throw new InvalidInputError(`${key} is not an editable Employee profile field`);
    submitted.set(key, normalizeValue(field, raw));
  }
  if (submitted.size === 0) throw new InvalidInputError("changes is empty");

  if (!(await actorHasCapability(db, roles, input.actorUid))) {
    // The denial is recorded on the same immutable trail as the change it refused, and stays
    // authoritative even if recording it fails -- the reset command's D-PRE3-AUDIT-DURABILITY rule.
    try {
      await recordStandaloneAuditEvent({
        actorUid: input.actorUid,
        action: UPDATE_ACTION,
        targetType: EMPLOYEE_TARGET_TYPE,
        targetId: input.employeeId,
        outcome: "denied",
        summary: `Denied: actor lacks ${EMPLOYEE_PROFILE_CAPABILITY}.`,
      }, db);
    } catch (err) {
      console.error("employee profile denial audit failed (denial remains authoritative)", {
        error: (err as Error)?.message,
      });
    }
    throw new UnauthorizedActorError(`actor is not authorized for "${EMPLOYEE_PROFILE_CAPABILITY}"`);
  }

  const employeeRef = db.collection(EMPLOYEES_COLLECTION).doc(input.employeeId);
  const managerId = submitted.has("managerEmployeeId")
    ? (submitted.get("managerEmployeeId") as string | null)
    : undefined;
  const submittedNumber = submitted.has("employeeNumber")
    ? (submitted.get("employeeNumber") as string | null)
    : undefined;

  return db.runTransaction(async (txn): Promise<UpdateEmployeeProfileOutcome> => {
    // EVERY READ BEFORE EVERY WRITE -- Firestore transactions require it, and the manager
    // existence check is a read.
    const firstEventRef = auditEventDocRef(fieldEventId(input.idempotencyKey, 0), db);
    const [employeeSnap, firstEventSnap] = await Promise.all([
      txn.get(employeeRef),
      txn.get(firstEventRef),
    ]);

    if (!employeeSnap.exists) {
      throw new EmployeeNotFoundError(`no employee record for the requested id`);
    }
    const current = employeeSnap.data() as Record<string, unknown>;

    if (firstEventSnap.exists) {
      const existing = firstEventSnap.data() as Record<string, unknown>;
      // The key is the caller's; reusing it for a DIFFERENT record or a different first field is a
      // conflict, never a quiet overwrite of somebody else's event.
      if (existing.targetId !== input.employeeId || existing.action !== UPDATE_ACTION) {
        throw new IdempotencyKeyConflictError(
          "this idempotencyKey was already used for a different request",
        );
      }
      return { status: "replayed", changedFields: [], auditEventIds: [] };
    }

    // Referential integrity for the one relational field. A manager pointer to a document that
    // does not exist is a broken link rendered as a name that never resolves, so it is refused at
    // the write rather than discovered at the read.
    if (typeof managerId === "string") {
      if (managerId === input.employeeId) {
        throw new InvalidInputError("an employee cannot be their own manager");
      }
      const managerSnap = await txn.get(db.collection(EMPLOYEES_COLLECTION).doc(managerId));
      if (!managerSnap.exists) {
        throw new UnknownManagerError("the selected manager is not an existing employee");
      }
    }

    // ════════════════════ EMPLOYEE NUMBER: CLAIM, RELEASE, REFUSE ════════════════════
    //
    // Read before write, inside the transaction, keyed by the normalized number -- so a document id
    // does the locking and two concurrent claims of the same unused number cannot both succeed.
    //
    // Only when the number actually CHANGES. Re-submitting the number a record already holds must
    // not read as a collision with itself, and must not re-claim a key that is already theirs.
    const previousNumber = typeof current.employeeNumber === "string" ? current.employeeNumber : null;
    const numberChanges =
      submittedNumber !== undefined && (submittedNumber ?? null) !== previousNumber;

    if (numberChanges && submittedNumber !== null) {
      const claimRef = db
        .collection(EMPLOYEE_NUMBER_REGISTRY_COLLECTION)
        .doc(normalizeEmployeeNumberKey(submittedNumber));
      const claimSnap = await txn.get(claimRef);
      const heldBy = claimSnap.exists
        ? ((claimSnap.data() as Record<string, unknown>).employeeId as string | undefined)
        : undefined;
      // A claim held by THIS employee is not a conflict -- it is a record whose registry entry
      // survived a case change ("taz-0042" -> "TAZ-0042" is the same key), which must be allowed.
      if (heldBy !== undefined && heldBy !== input.employeeId) {
        throw new EmployeeNumberTakenError("this employee number is already assigned");
      }
    }

    // The DIFF, against what is stored right now inside the transaction -- not against whatever
    // the client last read. A field the caller submitted unchanged is not a change, and a
    // concurrent edit to a field this caller never touched survives, because only changed keys
    // are written.
    const changed = EDITABLE_EMPLOYEE_FIELDS.filter(
      (f) => submitted.has(f.key) && !sameValue(readAt(current, f.key), submitted.get(f.key)),
    );

    if (changed.length === 0) {
      // Nothing written: no document write, no Audit Event, no accessVersion churn. A no-op save
      // is a no-op, and the trail must not suggest otherwise.
      return { status: "unchanged", changedFields: [], auditEventIds: [] };
    }

    const update: Record<string, unknown> = { updatedAt: Date.now() };
    for (const field of changed) {
      // Dotted paths are field paths to Firestore's `update` semantics, but this uses `set` with
      // merge (the document may legitimately lack the `address` map entirely), so nested keys are
      // composed into the nested object shape by hand.
      if (field.key.includes(".")) {
        const [head, tail] = field.key.split(".");
        const bucket = (update[head] as Record<string, unknown>) ?? {};
        bucket[tail] = submitted.get(field.key);
        update[head] = bucket;
      } else {
        update[field.key] = submitted.get(field.key);
      }
    }
    txn.set(employeeRef, update, { merge: true });

    // The registry moves WITH the record, in the same commit: claim the new key, release the old
    // one. Staged only when the number actually changed -- and only after `changed` proved it did,
    // so a resubmitted identical value touches neither the record nor the registry.
    if (numberChanges && changed.some((f) => f.key === "employeeNumber")) {
      if (submittedNumber !== null) {
        txn.set(
          db.collection(EMPLOYEE_NUMBER_REGISTRY_COLLECTION).doc(normalizeEmployeeNumberKey(submittedNumber)),
          { employeeId: input.employeeId, employeeNumber: submittedNumber, updatedAt: Date.now() },
        );
      }
      // Release the previous key so the number can be reissued. Skipped when the two normalize to
      // the SAME key (a case correction), which would otherwise delete the claim just made.
      if (
        previousNumber !== null &&
        (submittedNumber === null ||
          normalizeEmployeeNumberKey(previousNumber) !== normalizeEmployeeNumberKey(submittedNumber))
      ) {
        txn.delete(
          db.collection(EMPLOYEE_NUMBER_REGISTRY_COLLECTION).doc(normalizeEmployeeNumberKey(previousNumber)),
        );
      }
    }

    const auditEventIds = changed.map((field, index) => {
      const previous = renderValue(readAt(current, field.key));
      const next = renderValue(submitted.get(field.key));
      return stageAuditEventWithId(txn, fieldEventId(input.idempotencyKey, index), {
        actorUid: input.actorUid,
        action: UPDATE_ACTION,
        targetType: EMPLOYEE_TARGET_TYPE,
        targetId: input.employeeId,
        outcome: "applied",
        // The summary names the field and nothing about the values -- the values have their own
        // validated, secret-scanned fields, and duplicating them into free text would put the
        // same content past a weaker guard.
        summary: `Updated employee profile field "${field.key}".`,
        fieldKey: field.key,
        previousValue: previous,
        newValue: next,
        // The SAME database the transaction belongs to -- see stageAuditEventWithId.
      }, db);
    });

    return {
      status: "applied",
      changedFields: changed.map((f) => f.key),
      auditEventIds,
    };
  });
}
