// EOS Ownership Model v1 — the TYPED OWNER shape and its derivations (Owner rulings D-1/D-2/D-3,
// 2026-08-30).
//
//     owner = { type: "USER" | "COMPANY", id: <governed id> }
//
// INERT, DERIVED, READ-NORMALIZED. This module writes nothing and stores nothing. Per ruling D-1
// it composes the ownership authorities that ALREADY exist rather than replacing them:
//
//   accounts            -> accountOwner (the 7-field Person Assignment map) stays authoritative
//                          storage; the typed owner is projected from it
//   opportunities /
//   sales_orders /
//   sales_agreements    -> ownerEmployeeId stays authoritative storage
//   company-owned       -> operatingCompanyAuthority.js supplies the id namespace
//
// "Do not create two independently writable authorities" — so there is no setter here. Writes
// continue through the existing governed paths until the ownership write authority is
// deliberately activated at the census/backfill gate.
//
// THE `USER` ID NAMESPACE IS THE CANONICAL EMPLOYEE ID. Ruling D-1 named the type "USER"; it did
// not name the identifier. Every person-owned family in the matrix already stores a canonical
// Employee id (accountOwner.assignedToEmployeeId; ownerEmployeeId on the three commercial
// families), and only the Account additionally stores a linked user uid. Deriving a uid for an
// Opportunity would therefore require a cross-collection lookup that can FAIL — which would make
// this projection fallible, and a fallible projection cannot be "read-normalized". The Employee
// id is the one identifier every family carries natively, so it is the one the projection uses.
// Flagged to the Owner as open item O-1; changing it later is a change to this one function.
//
// NON-COLLAPSE (ruling): none of `currentOwner` (a reorder-request ROLE QUEUE), coverage/territory,
// `explicitTitleHolder` (legal title — ruling D-3 keeps it a separate axis), `assignedTo`, or
// `createdBy` is read by this module. They are presumed distinct authorities and are not inputs
// to ownership. Equipment is the sharpest case and it is legitimate for a record to carry
// owner={type:"COMPANY",id:"taylor"} while its title holder is a CUSTOMER; both facts are true
// and neither derives the other.
//
// PURE: no Firebase import. Mirrored decision-for-decision by functions/src/ownership/typedOwner.ts.

import { isOperatingCompanyIdShape, resolveOperatingCompany } from "./operatingCompanyAuthority.js";

export const OWNER_TYPES = Object.freeze({
  USER: "USER",
  COMPANY: "COMPANY",
});

/**
 * Census/derivation vocabulary. The Owner's next gate asks for totals in exactly these terms, so
 * they are defined once, here, and every producer uses these strings rather than its own words.
 *
 *   RESOLVED   — exactly one governed owner was derived.
 *   UNRESOLVED — an ownership-bearing field IS present but does not resolve to a governed owner
 *                (an incomplete accountOwner map, a blank ownerEmployeeId, an unknown company id).
 *   AMBIGUOUS  — more than one ownership-bearing field is present and they DISAGREE. Never
 *                silently pick one; the ruling forbids silent assignment.
 *   OWNERLESS  — no ownership-bearing field is present at all.
 *
 * UNRESOLVED and OWNERLESS are kept apart because they need different remediation: the first is a
 * broken value to repair, the second is a missing decision to make.
 */
export const OWNERSHIP_RESOLUTION = Object.freeze({
  RESOLVED: "RESOLVED",
  UNRESOLVED: "UNRESOLVED",
  AMBIGUOUS: "AMBIGUOUS",
  OWNERLESS: "OWNERLESS",
});

const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Shape guard for an already-typed owner value. Rejects extra keys — a typed owner is exactly two fields. */
export function isTypedOwner(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("id")) return false;
  if (value.type === OWNER_TYPES.USER) return nonEmptyString(value.id);
  if (value.type === OWNER_TYPES.COMPANY) return isOperatingCompanyIdShape(value.id);
  return false;
}

/** Build a typed owner, or null if the inputs do not describe one. The only constructor. */
export function typedOwner(type, id) {
  const candidate = { type, id: typeof id === "string" ? id.trim() : id };
  return isTypedOwner(candidate) ? Object.freeze(candidate) : null;
}

// --- Derivations ------------------------------------------------------------
//
// Each returns { resolution, owner, reason, code } — never a bare owner, because the census needs
// to distinguish the failure modes from each other and a null cannot carry that.
//
// `code` splits UNRESOLVED into the two facts the Owner's census ruling asks for as separate
// columns:
//   INVALID — the stored value is malformed or the wrong shape. Something is broken.
//   UNKNOWN — well-formed but names nothing this build recognises. Nothing is broken.
// They need different remediation, so they are not one bucket. Person-owned families produce
// INVALID only: an UNKNOWN for an employee id would need a cross-collection existence lookup, which
// ruling O-1 explicitly excluded from ownership resolution. A USER family's UNKNOWN count is
// therefore structurally zero, not merely empty.

const outcome = (resolution, owner, reason, code) => ({
  resolution,
  owner,
  reason: reason ?? null,
  code: code ?? null,
});

/**
 * Account -> typed owner, projected from the EXISTING accountOwner Person Assignment map.
 *
 * Deliberately requires only the ASSIGNEE half (assignedToEmployeeId). The full seven-field
 * completeness invariant (commercialProfile.js isCompleteAccountOwner) governs what may be
 * WRITTEN; this projection describes what is currently STORED. Holding a read to the write
 * invariant would report a legitimately-owned legacy Account as ownerless, which is precisely the
 * miscount the census exists to avoid. A stored map missing its assignee is UNRESOLVED, not
 * OWNERLESS — something is there and it is broken.
 */
export function deriveAccountOwner(accountDoc) {
  const map = accountDoc?.accountOwner;
  if (map === null || map === undefined) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, "no accountOwner");
  if (typeof map !== "object" || Array.isArray(map)) {
    return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, "accountOwner is not a map", "INVALID");
  }
  const employeeId = map.assignedToEmployeeId;
  if (!nonEmptyString(employeeId)) {
    return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, "accountOwner has no assignedToEmployeeId", "INVALID");
  }
  const owner = typedOwner(OWNER_TYPES.USER, employeeId);
  return owner === null
    ? outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, "assignedToEmployeeId is not a usable id", "INVALID")
    : outcome(OWNERSHIP_RESOLUTION.RESOLVED, owner);
}

/** Opportunity / Sales Order / Sales Agreement -> typed owner, projected from ownerEmployeeId. */
export function deriveEmployeeRefOwner(doc, field = "ownerEmployeeId") {
  const value = doc?.[field];
  if (value === null || value === undefined) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
  if (!nonEmptyString(value)) return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is empty or not a string`, "INVALID");
  const owner = typedOwner(OWNER_TYPES.USER, value);
  return owner === null
    ? outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a usable id`, "INVALID")
    : outcome(OWNERSHIP_RESOLUTION.RESOLVED, owner);
}

/**
 * A company-owned record -> typed owner. INACTIVE resolves: a record owned by a company that has
 * since been deactivated still HAS an owner, and reporting it as unresolved would invite a
 * backfill to reassign it. Only INVALID/UNKNOWN are unresolved.
 */
export function deriveCompanyOwner(doc, field = "operatingCompanyId") {
  const value = doc?.[field];
  if (value === null || value === undefined) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, `no ${field}`);
  const { state } = resolveOperatingCompany(value);
  if (state === "INVALID") return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is malformed`, "INVALID");
  if (state === "UNKNOWN") return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} names no seeded company`, "UNKNOWN");
  const owner = typedOwner(OWNER_TYPES.COMPANY, value);
  return owner === null
    ? outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, `${field} is not a usable id`, "INVALID")
    : outcome(OWNERSHIP_RESOLUTION.RESOLVED, owner);
}

/**
 * Combine the derivations that apply to one record. AMBIGUOUS when two of them RESOLVE to
 * different owners — the ruling forbids silently picking one, so this reports the conflict and
 * returns no owner rather than choosing.
 *
 * A single UNRESOLVED beside a RESOLVED is NOT ambiguity: one field is broken, the other answers.
 * The broken field is still named in `reason` so the census can point at it.
 */
export function combineOwnerDerivations(outcomes) {
  const list = (outcomes ?? []).filter(Boolean);
  if (list.length === 0) return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, "no ownership-bearing field");

  const resolved = list.filter((o) => o.resolution === OWNERSHIP_RESOLUTION.RESOLVED);
  const distinct = new Set(resolved.map((o) => `${o.owner.type}:${o.owner.id}`));
  if (distinct.size > 1) {
    return outcome(OWNERSHIP_RESOLUTION.AMBIGUOUS, null, `conflicting owners: ${[...distinct].sort().join(", ")}`);
  }
  if (resolved.length > 0) {
    const broken = list.filter((o) => o.resolution === OWNERSHIP_RESOLUTION.UNRESOLVED).map((o) => o.reason);
    return outcome(OWNERSHIP_RESOLUTION.RESOLVED, resolved[0].owner, broken.length > 0 ? broken.join("; ") : null);
  }
  const unresolved = list.filter((o) => o.resolution === OWNERSHIP_RESOLUTION.UNRESOLVED);
  if (unresolved.length > 0) {
    // INVALID wins over UNKNOWN when a record manages both: a broken value is the more urgent
    // fact, and reporting it as merely unrecognised would understate the repair needed.
    const code = unresolved.some((o) => o.code === "INVALID") ? "INVALID" : (unresolved[0].code ?? "INVALID");
    return outcome(OWNERSHIP_RESOLUTION.UNRESOLVED, null, unresolved.map((o) => o.reason).join("; "), code);
  }
  return outcome(OWNERSHIP_RESOLUTION.OWNERLESS, null, list.map((o) => o.reason).filter(Boolean).join("; ") || null);
}
