// Explicit .js extension: this module is imported by a plain-node pure test, so the
// specifier must be node-ESM-resolvable -- the same convention accountPortfolio.js /
// commercialProfile.js already use for exactly that reason.
import { EQUIPMENT_STATUS } from "./constants.js";

// Equipment & Installed Asset Management -- Issue #232, unit E1 (Domain
// foundation) of docs/implementation-plans/equipment-and-installed-asset-management.md,
// implementing docs/specifications/equipment-and-installed-asset-management.md
// under ADR-006.
//
// PURE and dependency-free beyond ./constants (which imports nothing), so this
// module is node-importable and unit-tested directly (test/equipmentDomain.test.mjs)
// without a browser or emulator -- the same pattern as domain/accountPortfolio.js.
//
// **There is NO write path here.** E1 is deliberately read/compute-only: the
// Firestore repository/hooks land in E2, Rules/indexes in E3. Nothing in this file
// touches firebase, and nothing here authorizes anything -- Firestore Rules and (for
// move/lifecycle) the trusted writer remain the sole authorities.

const STATUSES = new Set(Object.values(EQUIPMENT_STATUS));

// Spec §3 allowed transitions. ACTIVE <-> INACTIVE (plain); ACTIVE/INACTIVE ->
// RETIRED (confirmed, destructive); RETIRED -> ACTIVE (reactivate, confirmed).
// RETIRED -> INACTIVE is NOT allowed: a retired asset reactivates to ACTIVE only.
const ALLOWED_TRANSITIONS = {
  [EQUIPMENT_STATUS.ACTIVE]: [EQUIPMENT_STATUS.INACTIVE, EQUIPMENT_STATUS.RETIRED],
  [EQUIPMENT_STATUS.INACTIVE]: [EQUIPMENT_STATUS.ACTIVE, EQUIPMENT_STATUS.RETIRED],
  [EQUIPMENT_STATUS.RETIRED]: [EQUIPMENT_STATUS.ACTIVE],
};

// ---------------------------------------------------------------- status ----

// Normalize a stored/incoming status to the canonical enum. Unknown, missing, or
// malformed values fail closed to null (never silently coerced to ACTIVE) so a
// caller must decide explicitly rather than inherit a wrong default.
export function normalizeEquipmentStatus(value) {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return STATUSES.has(upper) ? upper : null;
}

export function isValidEquipmentStatus(value) {
  return normalizeEquipmentStatus(value) !== null;
}

// The status EXACTLY as Rules read it: `status == "ACTIVE" || ...`, with no trim and no
// case-fold (firestore.rules equipmentStatusValid). Anything else is null.
//
// This exists because normalizeEquipmentStatus is more forgiving than Rules are, and for
// a STORED status that difference is a live divergence rather than a nicety: a record
// holding "active" or " ACTIVE " normalizes to ACTIVE here while Rules see a status that
// is not valid at all and deny the write. Rules say so deliberately -- such a record "is
// permanently uneditable on this path and is repairable only by E10's trusted writer".
// The client has to agree, or it tells the user yes and the write says no.
//
// Incoming FORM values still go through normalizeEquipmentStatus: being forgiving about
// what a caller hands us is fine, because the payload always writes the canonical value.
// Being forgiving about what is already STORED is what breaks the mirror.
export function canonicalEquipmentStatus(value) {
  return STATUSES.has(value) ? value : null;
}

// Is `to` reachable from `from`? Unknown statuses on either side => false.
export function canTransitionEquipmentStatus(from, to) {
  const a = normalizeEquipmentStatus(from);
  const b = normalizeEquipmentStatus(to);
  if (!a || !b || a === b) return false;
  return (ALLOWED_TRANSITIONS[a] ?? []).includes(b);
}

export function isRetired(equipment) {
  return normalizeEquipmentStatus(equipment?.status) === EQUIPMENT_STATUS.RETIRED;
}

// ------------------------------------------------------ input normalization --

// Exported for the edit form (E8): it must seed its controls through the SAME normalizer
// the diff compares with, or the two disagree about what the record says and a change the
// user can see reports as no change.
export function trimmedOrNull(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// THE RECORD CONTRACT (#287). One question, one answer: is this a thing I can read
// fields off? Before this existed, the helpers disagreed -- the `= {}` parameter default
// only fires for `undefined`, so every OTHER malformed input flowed straight past it.
// `null` threw a TypeError, while a string or a number silently produced an all-null
// record that later read as "valid". Two different wrong answers, neither of them "no".
//
// isRecord itself answers for exactly these:
//    a plain object (incl. Object.create(null))     -> a record; read it
//    null, undefined                                -> not a record
//    string/number/boolean/array/Map/Date/instance  -> not a record
//
// Note what the PUBLIC helpers layer on top, because it is a deliberate difference and
// not an oversight: their `= {}` default fires first, so an OMITTED argument never
// reaches isRecord and is read as the empty record. Absent is not malformed. Calling
// with no argument is the normal JS affordance and its meaning is `{}` -- an empty
// create form owes the user field errors naming what to fill in, not an opaque "could
// not read" pointing at no control. Only a supplied non-record is `malformed`.
// So, for the two payload BUILDERS: absent -> empty record; malformed -> refused; a
// record -> read. Three cases, two of which fail closed, none of which throw.
// normalizeEquipmentInput is the one exception, and deliberately so: it has no refusal
// channel, so malformed also yields the empty record and fails closed downstream when
// validation finds every required field null.
//
// Both tests below are load-bearing, and neither subsumes the other:
//   - The PROTOTYPE test rejects Map, Date and class instances, whose `.accountId` is
//     `undefined` rather than an error -- exactly how they slip past a check that only
//     asks "typeof === object" and get read as a record full of blanks. It accepts a
//     null prototype, because `Object.create(null)` is what some deserializers hand
//     back and it is readable in the way that matters here.
//   - Array.isArray is NOT redundant with it. `Object.setPrototypeOf([], Object.prototype)`
//     is still a real array yet passes the prototype test, so dropping this line lets an
//     array carrying a `name` produce a valid edit payload. Removing it as "dead code"
//     is a mistake this module has already made once, in review of #287.
//
// This is also the single type test for the searchEquipment options bag (#285/#286),
// which previously had a byte-identical private copy. Collections answer "nothing" ([])
// and records answer "invalid" -- but that difference lives in the callers, not in two
// copies of the same question that can drift apart.
function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Spec §1/§2: optional strings are trimmed, empty -> null; required strings are
// trimmed. Only the specified fields survive -- unknown keys are dropped here, and
// the write path (E2) plus Rules (E3) reject them independently.
export function normalizeEquipmentInput(values = {}) {
  // A non-record normalizes to the empty record rather than throwing (null) or
  // pretending (a string, whose .accountId is undefined). Every field then reads null,
  // which validateEquipmentInput rejects -- so garbage in becomes INVALID, not a crash
  // and not a plausible-looking record.
  if (!isRecord(values)) values = {};
  return {
    accountId: trimmedOrNull(values.accountId),
    locationId: trimmedOrNull(values.locationId),
    name: trimmedOrNull(values.name),
    status: normalizeEquipmentStatus(values.status) ?? EQUIPMENT_STATUS.ACTIVE,
    manufacturer: trimmedOrNull(values.manufacturer),
    model: trimmedOrNull(values.model),
    serialNumber: trimmedOrNull(values.serialNumber),
    assetTag: trimmedOrNull(values.assetTag),
    installedDate: trimmedOrNull(values.installedDate),
    warrantyExpiresDate: trimmedOrNull(values.warrantyExpiresDate),
    notes: trimmedOrNull(values.notes),
  };
}

// -------------------------------------------------------------- validation --

// Spec §2. Required: accountId, locationId, name (non-blank), status (valid; the
// normalizer defaults a missing one to ACTIVE). Duplicate names within an Account
// are ALLOWED (real-world) -- disambiguated in the UI by Location/manufacturer/
// model/serial, never rejected here.
//
// Returns { valid, errors: { field: message }, value } -- `value` is the normalized
// payload, safe to hand to E2's write path only when `valid` is true.
export function validateEquipmentInput(values = {}) {
  const value = normalizeEquipmentInput(values);
  const errors = {};
  if (!value.accountId) errors.accountId = "Select a customer.";
  if (!value.locationId) errors.locationId = "Select a location.";
  if (!value.name) errors.name = "Enter an equipment name.";
  if (!isValidEquipmentStatus(value.status)) errors.status = "Select a valid status.";
  return { valid: Object.keys(errors).length === 0, errors, value };
}

// ------------------------------------------ Account / Location relationships --

// Spec §4: an Equipment's Location must belong to its owning Account. A missing or
// malformed Location fails closed (false) -- never treated as "probably fine".
export function locationBelongsToAccount(location, accountId) {
  if (!location || typeof accountId !== "string" || accountId === "") return false;
  return location.accountId === accountId;
}

// The Locations a piece of Equipment for `accountId` may be installed at / moved to.
// Cross-Account destinations are excluded here as well as denied by Rules (E3).
export function locationsForAccount(locations = [], accountId) {
  // A non-array collection is malformed input. The `= []` default only fires for
  // undefined, so anything else reached .filter and raised a TypeError -- a crash at
  // whatever surface happened to call it, rather than an answer it could handle.
  // Empty is the honest answer: we were given no usable set of Locations.
  if (!Array.isArray(locations)) return [];
  if (typeof accountId !== "string" || accountId === "") return [];
  return locations.filter((l) => locationBelongsToAccount(l, accountId));
}

// Whole-record ownership check: the equipment names an Account and a Location, and
// that Location resolves to the same Account.
export function equipmentOwnershipValid(equipment, location) {
  if (!equipment?.accountId || !equipment?.locationId) return false;
  if (!location || location.id !== equipment.locationId) return false;
  return locationBelongsToAccount(location, equipment.accountId);
}

// Spec §4: ordinary edits must never change ownership. Pure predicate the edit
// surface (E8) and its tests use; Rules (E3) enforce it independently.
//
// FAILS CLOSED ON INPUT IT CANNOT EVALUATE (#287). This is a GOVERNANCE PREDICATE:
// answering "yes, ownership is unchanged" is a safety claim, and it must only ever be
// made about two records we actually understood. It used to answer TRUE for garbage --
// ownershipUnchanged("garbage", {}) was true, because "garbage".accountId and
// {}.accountId are both undefined and undefined === undefined. That is the worst
// possible direction for a predicate whose true means "go ahead".
//
// Not exploitable when filed (nothing called it -- E2 governs via changedGoverned), but
// this module names E8 as its intended consumer, so it was a trap set for E8 rather
// than a live defect. Fixed before E8 arrives.
export function ownershipUnchanged(before, after) {
  if (!isRecord(before) || !isRecord(after)) return false;
  // Ownership must be PRESENT and comparable on both sides. Two records that merely
  // agree on "undefined" have not been shown to share an owner -- they have been shown
  // to lack one.
  const beforeOwned = isNonEmptyString(before.accountId) && isNonEmptyString(before.locationId);
  const afterOwned = isNonEmptyString(after.accountId) && isNonEmptyString(after.locationId);
  if (!beforeOwned || !afterOwned) return false;
  return before.accountId === after.accountId && before.locationId === after.locationId;
}

// ------------------------------------------------------------ presentation --

// The human reference (Spec §8): the display name, never the raw document id.
export function equipmentDisplayName(equipment) {
  return trimmedOrNull(equipment?.name) ?? "Unnamed equipment";
}

// A one-line disambiguating summary -- duplicate names are legal, so surface the
// distinguishing context. Omits empty parts; never renders a raw id.
export function equipmentSummary(equipment) {
  const parts = [
    [trimmedOrNull(equipment?.manufacturer), trimmedOrNull(equipment?.model)].filter(Boolean).join(" "),
    trimmedOrNull(equipment?.serialNumber) ? `S/N ${trimmedOrNull(equipment.serialNumber)}` : null,
    trimmedOrNull(equipment?.assetTag) ? `Tag ${trimmedOrNull(equipment.assetTag)}` : null,
  ].filter((p) => p && p !== "");
  return parts.join(" · ");
}

// ------------------------------------------------------------ safe errors ----

// Safe, categorized copy for an Equipment read/write failure. Never surfaces a raw
// Firebase code, document id, or internal detail -- the same discipline as the other
// domain *SaveErrorMessage helpers.
export function equipmentSaveErrorMessage(err) {
  if (err?.blocked) return "Saving is disabled in this mode — no equipment was saved.";
  const code = typeof err?.code === "string" ? err.code.split("/").pop() : "";
  if (code === "permission-denied" || code === "unauthenticated") {
    return "You do not have permission to save this equipment. Nothing was saved.";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "The service is temporarily unavailable. Nothing was saved — please try again.";
  }
  return "Could not save this equipment. Nothing was saved — please try again.";
}

// ------------------------------------------------- payloads & field guards ---
// (Issue #232 unit E2 -- still PURE. The firebase-touching repository that consumes
// these lives in ./equipmentRepository.js; these builders stay here so they are
// node-testable and so the field policy has exactly one definition.)

// Spec §1/§4: ownership + createdAt are GOVERNED. An ORDINARY edit must never change
// them -- a Location change is only the audited move. Rules (E3) re-enforce this
// independently; this constant is the client-side single source of that policy.
//
// STATUS IS NOT GOVERNED, and this is the #312 correction. It was in this list, so an
// ordinary edit refused every status change outright -- which contradicted Spec §6, AC3,
// and the Owner's E3 decision, and contradicted our own Rules, which have always
// permitted ACTIVE<->INACTIVE on the ordinary update path. Status is instead
// TRANSITION-CONTROLLED: the ordinary path may move it ACTIVE<->INACTIVE and no further
// (see ordinaryStatusChangeAllowed). Retire and reactivate remain trusted, audited
// lifecycle actions (§3/§5, E10) -- that is the whole of what E10 owns here.
export const GOVERNED_EQUIPMENT_FIELDS = Object.freeze(["accountId", "locationId", "createdAt"]);

// Spec §3 + the Owner's E3 decision: what an ORDINARY edit may do to `status`.
//
// This MIRRORS equipmentTransitionAllowed() in firestore.rules exactly, and the two must
// stay in lockstep -- Rules are the authority, this is the client saying the same thing
// so a user is told "no" by a control rather than by a rejected write:
//
//     unchanged            -> allowed
//     ACTIVE  <-> INACTIVE -> allowed (plain, no confirmation)
//     anything -> RETIRED  -> DENIED here; retire is a trusted, audited action (E10)
//     RETIRED  -> anything -> DENIED here; reactivate is a trusted action (E10)
//     unknown/missing      -> DENIED; a status we cannot read is not a status we may move
//
// A RETIRED asset therefore has a locked status in the ordinary form while staying
// descriptively editable (Owner E3 decision 2) -- retiring is not a freeze, but leaving
// retirement is not something you do by picking from a dropdown.
export function ordinaryStatusChangeAllowed(from, to) {
  // CANONICAL, not normalized -- see canonicalEquipmentStatus. Rules compare exact
  // strings, so a helper that trims and upper-cases would answer "yes" to transitions
  // Rules deny, which is the one direction that hurts: the control says go, the write
  // comes back permission-denied, and the user reads a generic failure.
  const a = canonicalEquipmentStatus(from);
  const b = canonicalEquipmentStatus(to);
  if (a === null || b === null) return false;
  if (a === b) return true;
  return (a === EQUIPMENT_STATUS.ACTIVE && b === EQUIPMENT_STATUS.INACTIVE)
      || (a === EQUIPMENT_STATUS.INACTIVE && b === EQUIPMENT_STATUS.ACTIVE);
}

// Everything an ordinary edit MAY change (Spec §6: descriptive/optional fields).
export const EDITABLE_EQUIPMENT_FIELDS = Object.freeze([
  "name", "manufacturer", "model", "serialNumber", "assetTag",
  "installedDate", "warrantyExpiresDate", "notes",
]);

// E8: which editable fields an edit form actually changed, against the stored record.
//
// This lives here, not in the form, because "did the user change anything?" is not
// `!==` and getting it wrong is invisible in a browser -- everything still saves. The
// form holds a STRING for every control ("" where the record holds null, padding where
// it holds a trimmed value), so a raw comparison reports a change on every optional
// field nobody touched: untouched values get rewritten, updatedAt is stamped on records
// nobody edited, another session's concurrent change is silently restored, and #287's
// "nothing was changed" answer becomes unreachable.
//
// It is also the reason the form cannot smuggle a governed field: the loop is over
// EDITABLE_EQUIPMENT_FIELDS, not over the caller's keys, so accountId/locationId/
// status/createdAt cannot enter the result whatever the form holds. E1's governed
// guard, E2's write path and E3's Rules each re-check that independently -- this is the
// first of four, not the only one.
//
// Returns only the changed keys. buildEquipmentEditPayload reads an ABSENT key as
// "unchanged", so a partial result is the point rather than an omission.
export function changedEquipmentFields(values, equipment) {
  if (!isRecord(values) || !isRecord(equipment)) return {};
  const changed = {};
  for (const f of EDITABLE_EQUIPMENT_FIELDS) {
    const raw = values[f];
    // A field is edited only if the caller supplied a STRING (a value) or NULL (cleared).
    // Everything else contributes nothing, for two different reasons that happen to share
    // an answer:
    //   undefined -- the control was not offered. Absent means unchanged; it is not a
    //                request to blank the field.
    //   anything else (number, object, Date...) -- a caller bug. The fail-closed answer
    //                is to write NOTHING for that field. Coercing it to null would CLEAR
    //                a stored value on the strength of that bug, and a clear is a write.
    // One check rather than two: a separate `raw === undefined` guard read as though it
    // were load-bearing, but this line already subsumes it -- verified, not assumed.
    if (raw === undefined) continue;

    // Anything that is neither a string nor null REFUSES THE WHOLE DIFF, rather than
    // dropping just that field. Dropping it reports success for an edit that was partly
    // discarded:
    //   { name: "RTU 2", manufacturer: 5 }  ->  { name: "RTU 2" }  ->  valid, saved
    // The name lands, the manufacturer edit vanishes, and the caller is told it worked --
    // exactly the shape #287 hardened `valid` against ("a dropped move reported as
    // success is worse than a refused edit"). The same reasoning holds for an ordinary
    // field. Returning {} makes it a no-op instead: nothing is written, and
    // buildEquipmentEditPayload answers `noop` rather than a partial success.
    //
    // Unreachable from the form, whose seed guarantees strings. This is the trap closed
    // before a future caller finds it -- the way ownershipUnchanged was closed for E8.
    if (raw !== null && typeof raw !== "string") return {};
    // BOTH SIDES ARE NORMALIZED THE SAME WAY. Normalizing only `next` compares a trimmed
    // form value against a raw stored one, so a record holding " Carrier " reports a
    // change on an untouched form and rewrites itself on save. Rules permit padded
    // strings (they only require a non-blank trimmed name), so such records are legal --
    // from an import, a seed, or a future trusted writer -- and "saving an untouched form
    // writes nothing" has to hold for them too.
    const next = trimmedOrNull(raw);
    const current = trimmedOrNull(equipment[f]);
    if (next !== current) changed[f] = next;
  }
  return changed;
}

// Create payload: the full validated record + updatedAt.
//
// `createdAt` is deliberately NOT set here -- makeCollectionStore.add() stamps it on
// write (the app-wide convention). Setting it here too would return one value to the
// caller while persisting another.
//
// Status is pinned ACTIVE (Spec §2). Reaching RETIRED/INACTIVE is a lifecycle
// transition that belongs to the trusted, audited seam, so create must not be usable
// as a side door into a non-ACTIVE state. A caller that explicitly asks for one is
// refused rather than silently overridden.
export function buildEquipmentCreatePayload(values = {}, now = 0) {
  // A non-record is refused explicitly rather than reaching validateEquipmentInput.
  // It would be rejected there anyway (normalize yields all-null, so accountId /
  // locationId / name all error), but those would be field errors blaming the user for
  // three fields they never supplied. `malformed` says what is actually true: the
  // caller handed us something unreadable, and no control on the form can fix it.
  if (!isRecord(values)) {
    return { valid: false, malformed: true, errors: {}, payload: null };
  }

  const { errors, value } = validateEquipmentInput(values);

  // An UNRECOGNIZED status is refused too, not quietly defaulted to ACTIVE: the
  // caller asked for something we could not honour, and silently substituting a
  // lifecycle state is exactly the kind of quiet divergence this unit exists to
  // prevent -- even when the substitute is the safe one.
  if (values.status !== undefined) {
    const requested = normalizeEquipmentStatus(values.status);
    if (requested === null) errors.status = "Select a valid status.";
    else if (requested !== EQUIPMENT_STATUS.ACTIVE) errors.status = "New equipment is always created active.";
  }

  // Every return path below carries the same keys, `malformed` included. A shape that
  // varies by path forces callers (and tests) to write `!== true` where they mean
  // `=== false`, and makes an absent key indistinguishable from a false one.
  if (Object.keys(errors).length > 0) return { valid: false, malformed: false, errors, payload: null };

  return {
    valid: true,
    malformed: false,
    errors: {},
    payload: { ...value, status: EQUIPMENT_STATUS.ACTIVE, updatedAt: now },
  };
}

// The governed value as it would actually be stored, so the change check compares
// like with like. Without this, a caller round-tripping a record with "active" or a
// padded id reads as a governed CHANGE and gets its whole edit refused.
function governedValue(field, raw) {
  if (raw === undefined) return undefined;
  if (field === "createdAt") return raw;
  return trimmedOrNull(raw);
}

// Ordinary-edit payload.
//
// Two independent protections, because they fail differently:
//
//  1. BY CONSTRUCTION -- only editable fields the caller actually supplied reach the
//     payload. A governed field can never be written here even if a caller spreads a
//     whole record in, and fields the caller did not touch are left alone rather than
//     overwritten with null.
//  2. LOUDLY -- if the caller genuinely ASKED to change a governed field, refuse the
//     whole edit via `changedGoverned` instead of dropping it and reporting success.
//
// `before` is what proves a governed field is unchanged. Both refusals fail closed,
// but they are reported SEPARATELY because they are different bugs with different
// audiences: `changedGoverned` is a user asking for something this surface may not do,
// while `unprovableGoverned` is a CALLER that supplied no `before` to compare against.
// Conflating them makes E8 accuse the user of a programming error they cannot fix.
export function buildEquipmentEditPayload(values = {}, before = {}, now = 0) {
  // MALFORMED `values` IS REFUSED, not quietly turned into a no-op (#287).
  //
  // buildEquipmentEditPayload("garbage", {}, 1) used to return { valid: true, payload:
  // { updatedAt: 1 } }: every editable key was absent from the string, so nothing was
  // written except a timestamp -- and the caller was told the edit SUCCEEDED. An edit
  // that changed nothing must never look like an edit that worked.
  // Reported as `malformed`, NOT as a field error. A malformed `values` is a CALLER
  // bug: there is no field the user could correct, so a { field: message } entry would
  // send E8 looking for a control to highlight and find none. Same reasoning, and the
  // same shape, as `unprovableGoverned` below.
  if (!isRecord(values)) {
    return {
      valid: false,
      malformed: true,
      noop: false,
      refusedStatus: false,
      unprovableStatus: false,
      errors: {},
      payload: null,
      changedGoverned: [],
      unprovableGoverned: [],
    };
  }

  // `before` is EVIDENCE, and it is treated differently from `values` on purpose.
  // An empty `before` is already legal and meaningful -- it is what updateEquipmentWith
  // passes when it has no prior record -- and it means "I cannot prove anything". So
  // unreadable evidence collapses to that same no-evidence case rather than becoming a
  // separate error: absent, null and malformed all prove nothing, and saying so once is
  // the consistent contract. This stays fail-closed where it matters: the governed loop
  // reports any governed field it cannot prove unchanged as `unprovableGoverned`, and
  // (#312) a status change against unreadable evidence is refused outright, since a
  // transition cannot be checked without knowing the status it starts from. A
  // descriptive-only edit needs no evidence and proceeds, exactly as with `before = {}`.
  if (!isRecord(before)) before = {};

  const normalized = normalizeEquipmentInput(values);
  const errors = {};
  // Only validate what the caller is actually editing; an absent key means unchanged.
  if (values.name !== undefined && !normalized.name) errors.name = "Enter an equipment name.";

  // An edit that touches no editable field is not an edit. Writing a bare { updatedAt }
  // would report success for a change nobody made, and would bump the record's
  // timestamp as if something had happened to it. This is never `valid`, whatever the
  // reason -- but the REASON is reported separately below, because a governed-only edit
  // is a different thing from an empty one and the two owe the user different answers.
  const editedKeys = EDITABLE_EQUIPMENT_FIELDS.filter((f) => values[f] !== undefined);

  // STATUS (#312): transition-controlled, not governed and not an ordinary field.
  //
  //   not supplied      -> unchanged; nothing to check
  //   unrecognized      -> a FIELD error; the form has a status control to highlight
  //   same as `before`  -> not an edit; a re-submitted unchanged value writes nothing
  //   ACTIVE <-> INACTIVE -> a real edit, written through this ordinary path
  //   anything else     -> REFUSED (`refusedStatus`), not a field error: retire and
  //                        reactivate are trusted actions, so this is "not available
  //                        here", not "you typed it wrong" -- and for a RETIRED asset
  //                        the form does not even render the control.
  //   `before` unreadable -> `unprovableStatus`: a transition cannot be validated
  //                        without the status it starts from, so it fails closed. This
  //                        is what makes `before` LOAD-BEARING in the edit path for the
  //                        first time; it was defensive-only while status was governed.
  let statusChange = null;
  let refusedStatus = false;
  let unprovableStatus = false;
  if (values.status !== undefined) {
    const asked = normalizeEquipmentStatus(values.status);      // a caller's input: forgiving
    const current = canonicalEquipmentStatus(before.status);     // what is STORED: exact, as Rules read it
    if (asked === null) errors.status = "Select a valid status.";
    else if (current === null) unprovableStatus = true;
    else if (asked === current) { /* unchanged -- not an edit, and not an error */ }
    else if (ordinaryStatusChangeAllowed(current, asked)) statusChange = asked;
    else refusedStatus = true;
  }

  const changedGoverned = [];
  const unprovableGoverned = [];
  for (const f of GOVERNED_EQUIPMENT_FIELDS) {
    const asked = governedValue(f, values[f]);
    if (asked === undefined) continue;           // not asked for -> nothing to police
    const current = governedValue(f, before[f]);
    if (current === undefined) unprovableGoverned.push(f);
    else if (asked !== current) changedGoverned.push(f);
  }

  const payload = { updatedAt: now };
  for (const f of EDITABLE_EQUIPMENT_FIELDS) {
    if (values[f] !== undefined) payload[f] = normalized[f];
  }
  // Only an actual transition reaches the payload -- never an unchanged status, which
  // would rewrite the field and bump updatedAt for a change nobody made.
  if (statusChange !== null) payload.status = statusChange;

  // "Nothing was changed" means exactly that: no editable field, AND no governed field
  // attempted. A caller asking to move an Account touched something real -- refusing it
  // as an empty edit would tell them the opposite of what they just did. That refusal
  // is `changedGoverned`'s to report, not this one's.
  // "Nothing was changed" must also mean nothing was WRONG. `errors` is in this
  // conjunction because #312 made the combination reachable for the first time: status is
  // the first error-producing field that is NOT in EDITABLE_EQUIPMENT_FIELDS, so it does
  // not contribute to editedKeys, and { status: "GARBAGE" } produced noop:true carrying
  // errors.status. updateEquipmentWith checks `noop` before `!valid`, so the user picked
  // an invalid status and was told "Nothing was changed." On main the pairing was
  // structurally unreachable -- errors.name required values.name, which forced
  // editedKeys > 0 -- so the invariant broke silently.
  const noop = editedKeys.length === 0 && statusChange === null
    && Object.keys(errors).length === 0
    && changedGoverned.length === 0 && unprovableGoverned.length === 0
    && !refusedStatus && !unprovableStatus;

  // `valid` means "this payload may be written" -- nothing weaker. A governed attempt
  // makes the WHOLE edit invalid, even when it also carries a legitimate rename.
  //
  // It previously did not: { name: "New", accountId: "acct-2" } returned valid:true with
  // payload { updatedAt, name }, because the payload loop simply never copies a governed
  // field. A caller doing the obvious `if (valid) store.update(id, payload)` would write
  // the rename, silently drop the move, and report success -- the exact failure
  // equipmentWrites names ("a dropped move reported as success is worse than a refused
  // edit"). updateEquipmentWith checks changedGoverned first and so was never exposed,
  // but E8 is a new caller and `valid` must not be a trap that only some callers dodge.
  const valid =
    Object.keys(errors).length === 0 &&
    (editedKeys.length > 0 || statusChange !== null) &&
    changedGoverned.length === 0 &&
    unprovableGoverned.length === 0 &&
    !refusedStatus &&
    !unprovableStatus;

  return {
    valid,
    malformed: false,
    noop,
    refusedStatus,
    unprovableStatus,
    errors,
    payload: valid ? payload : null,
    changedGoverned,
    unprovableGoverned,
  };
}

// ------------------------------------------- trusted-writer seam (contract) ---

// Move / retire / reactivate are trusted-writer, audited actions (Spec §5/§11) and
// are gated on Issue #15 (Functions undeployed). Until then they are UNAVAILABLE --
// never a client-direct fallback, never optimistic success, never simulated. This is
// the single shape every such contract returns, so callers (E9/E10 UI) can render a
// clear reason and keep the action disabled.
export const TRUSTED_ACTION_UNAVAILABLE_REASON = "trusted-writer-unavailable";

export function trustedActionUnavailable(action) {
  return Object.freeze({
    ok: false,
    unavailable: true,
    reason: TRUSTED_ACTION_UNAVAILABLE_REASON,
    action: action ?? null,
    // Safe, human copy -- names no provider, code, id, or credential.
    message: "This action isn't available yet. Nothing was changed.",
  });
}

// ---------------------------------------------------------------- search -----

// Spec §7: match over name / assetTag / serialNumber / manufacturer / model,
// case-insensitive substring. A blank term matches everything (the caller's filters
// still apply). Pure over an already-bounded, Account/Location-scoped set -- this
// never issues a query and never loops per record over the network.
// An OMITTED or empty term matches everything -- that is the documented "no search
// applied" case. A MALFORMED term (a number, an object, null) does not: it means the
// caller is not asking what they think they are asking, and answering "everything"
// turns a caller bug into a silent data disclosure. Fails closed instead.
export function equipmentMatchesSearch(equipment, term) {
  if (term === undefined || term === null) return true;   // omitted -> no search applied
  if (typeof term !== "string") return false;             // malformed -> fail closed
  const q = term.trim().toLowerCase();
  if (q === "") return true;                              // empty -> no search applied
  return [equipment?.name, equipment?.assetTag, equipment?.serialNumber, equipment?.manufacturer, equipment?.model]
    .some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}

// Spec §7 deterministic ordering: name ascending (case-insensitive), tie-break by
// id -- a total order, so the register's rendering is stable and testable.
export function compareEquipment(a, b) {
  const an = (a?.name ?? "").toLowerCase();
  const bn = (b?.name ?? "").toLowerCase();
  if (an < bn) return -1;
  if (an > bn) return 1;
  const ai = a?.id ?? "";
  const bi = b?.id ?? "";
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

// Search + optional Location/status filters + deterministic order, in one pure pass.
// Returns a new array; never mutates the input.
// Exactly the options searchEquipment implements. Anything else is a caller error.
const SEARCH_OPTION_KEYS = ["term", "locationId", "status"];

// The options bag is checked with isRecord (above): "is this a plain object I can read
// keys off?" is the same question, and it had drifted into two near-identical helpers
// that disagreed on one input. One test, one answer. What differs is what each CALLER
// does with a "no" -- this boundary returns [], the record helpers return invalid --
// and that belongs at the call site, not in a second copy of the type test.

// The options argument is UNTRUSTED INPUT, not a convenience.
//
// The destructuring default `= {}` only fires for `undefined`, so any other malformed
// argument -- a bare string, an array, a number -- destructures to all-defaults and
// silently means "no filters", i.e. RETURN EVERYTHING. That is fail-OPEN: the caller
// asked to narrow and got the whole register instead. It is an easy mistake to make,
// because `searchEquipment(list, "rooftop")` reads perfectly naturally and answers
// without complaint.
//
// The same trap exists one level down, at the KEY: `{ search: q }` or `{ location: id }`
// also destructures to all-defaults and returns everything, and is a likelier slip
// than the bare string. So an unrecognized key is rejected too -- guarding only the
// argument would relocate the defect rather than close it.
//
// The one behaviour deliberately preserved: a VALID omitted/empty options object
// still means "no search applied" and returns everything, ordered.
export function searchEquipment(equipment, options = {}) {
  if (!Array.isArray(equipment)) return [];
  if (!isRecord(options)) return [];
  // An unknown key means the caller is asking something this function does not
  // implement. Answering "everything" would be answering a question nobody asked.
  if (Object.keys(options).some((k) => !SEARCH_OPTION_KEYS.includes(k))) return [];

  const { term = "", locationId = null, status = null } = options;

  // term: omitted/empty is a valid no-op search; a non-string is malformed.
  if (term !== null && term !== undefined && typeof term !== "string") return [];

  // locationId: omitted is no filter; anything present must be a real, non-blank id.
  if (locationId !== null && locationId !== undefined) {
    if (typeof locationId !== "string" || locationId.trim() === "") return [];
  }

  // status: omitted is no filter. An explicitly supplied status must be a KNOWN one --
  // an unknown value returns nothing. It must never fall back to disabling the filter,
  // which would answer a narrower question with a broader answer.
  //
  // NOTE for E5's status selector (the register filter -- NOT E9, which is the move
  // flow and does not filter the register). This is deliberately asymmetric with
  // `term`: an empty term means "no search typed" -> everything, while an empty STATUS
  // is an explicitly supplied unknown status -> nothing.
  //   All      -> omit the property entirely, or pass status: null
  //   NOT      -> value="" -- the conventional <option value="">All</option> sentinel
  //               selects NOTHING here, not all.
  let wantStatus = null;
  if (status !== null && status !== undefined) {
    wantStatus = normalizeEquipmentStatus(status);
    if (wantStatus === null) return [];
  }

  return equipment
    .filter((e) => equipmentMatchesSearch(e, term))
    .filter((e) => (locationId ? e?.locationId === locationId : true))
    .filter((e) => (wantStatus ? normalizeEquipmentStatus(e?.status) === wantStatus : true))
    .slice()
    .sort(compareEquipment);
}

// -------------------------------------------------- service history (derived) --

// Spec §10: Equipment Service History is DERIVED from linked Work Orders -- there is
// no duplicate history ledger. Given the Work Orders already loaded by the caller,
// select those linked to this equipment and order them newest-first.
//
// Historical entries survive retirement (Spec §3) -- nothing here filters by the
// equipment's status. Returns { workOrderId, woNumber, status, type, at } entries --
// note workOrderId, NOT id: there is no `id` field on an entry, so a consumer keying
// a list by entry.id gets undefined for every row. The Work Order is carried through
// for linking; the raw equipment id is never a rendered reference.
export function equipmentServiceHistory(workOrders = [], equipmentId) {
  // Same boundary as locationsForAccount: a non-array raised a TypeError instead of
  // answering. Service History is DERIVED (§10) -- with no usable Work Orders there is
  // no history to derive, which is exactly an empty one.
  if (!Array.isArray(workOrders)) return [];
  if (typeof equipmentId !== "string" || equipmentId === "") return [];
  return workOrders
    .filter((wo) => wo?.equipmentId === equipmentId)
    .map((wo) => ({
      workOrderId: wo.id,
      woNumber: wo.woNumber ?? null,
      status: wo.status ?? null,
      type: wo.type ?? null,
      at: toMillis(wo.createdAt),
    }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

// Accepts a Firestore Timestamp (client or admin), a ms number, or a Date; anything
// else -> null (fail closed rather than render a wrong date).
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

// Group a derived history into buckets by calendar year, newest year first --
// the shape the detail page's Service History section renders.
export function groupServiceHistoryByYear(entries = []) {
  // A non-array is malformed input, not "iterate whatever this is". A string here
  // used to be walked CHARACTER BY CHARACTER into a fabricated group: each character
  // has a truthy `.at` (String.prototype.at), so the year guard passed and produced
  // `new Date(fn).getFullYear()` -> NaN, which `?? "Unknown"` does not catch. Garbage
  // in, confident-looking history out.
  if (!Array.isArray(entries)) return [];
  const buckets = new Map();
  for (const entry of entries) {
    const at = entry?.at;
    // Require an actual number: the original truthiness check let a function or string
    // through. `at !== 0` (not `at > 0`) reproduces the old falsy check EXACTLY --
    // 0/null/absent stay "Unknown", and a NEGATIVE at (a pre-1970 service date) still
    // groups by its real year rather than being quietly relabelled Unknown. The
    // Number.isFinite(year) guard catches an out-of-range timestamp, whose
    // getFullYear() is NaN -- which `?? "Unknown"` would NOT have caught.
    const year = typeof at === "number" && Number.isFinite(at) && at !== 0 ? new Date(at).getFullYear() : null;
    const key = Number.isFinite(year) ? year : "Unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      if (a[0] === "Unknown") return 1;
      if (b[0] === "Unknown") return -1;
      return b[0] - a[0];
    })
    .map(([year, items]) => ({ year, entries: items }));
}
