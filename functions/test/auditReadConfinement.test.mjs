// AUDIT READ IS MANAGEMENT OVERSIGHT, AND IT DOES NOT DRIFT DOWNWARD.
//
// ============================ WHAT WENT WRONG ============================
//
// Before the Owner decision of 2026-08-21, `audit.event.read` was held by `shopAssociate` and
// `partsAssociate` while `financeManager` and `operationsManager` could not read audit history at
// all. An associate-level role reading the audit trail while a manager-level finance role cannot is
// not a defensible ordering of oversight.
//
// Both halves followed CORRECTLY from their sources, which is the interesting part. The associate
// rows exist in the canonical Detailed CRUD sheet (Audit Log = R). financeManager has no row at all,
// because Finance Manager is not a workbook role. Two individually correct derivations produced a
// combination nobody would defend if asked directly.
//
// The tell was already in the matrix: `warehouseAssociate` has NO audit row. Parts and Shop
// associates read audit, warehouse associates do not, and no business reason distinguishes them --
// which is what an artifact of copying manager rows down to associates looks like.
//
// The Owner reconciled it toward management oversight and asked for a guard against the drift
// recurring. That is this file.
//
// ============================ WHAT THIS DOES NOT CLAIM ============================
//
// Audit READ is not security administration. It confers no `admin.*`, no role assignment, no
// capability administration, and no ability to alter or suppress audit evidence -- and that
// separation is asserted below, because "only admins may read the audit log" would be the wrong
// correction. Oversight that only the Owner can perform is not oversight.
import test from "node:test";
import assert from "node:assert/strict";
import { GOVERNED_BUSINESS_ROLES } from "../lib/access/governedBusinessRoles.js";
import { COMPATIBILITY_ROLES } from "../lib/access/compatibilityRoles.js";

const AUDIT_READ = "audit.event.read";

// The management Roles the Owner reviewed and approved for audit oversight, 2026-08-21.
// Approved on OVERSIGHT NEED, not title seniority: each of these is accountable for outcomes across
// a domain and can be asked "what happened here".
const APPROVED_AUDIT_READERS = [
  "owner",
  "generalManager",      // enterprise oversight
  "operationsManager",   // cross-domain operational oversight -- ADDED 2026-08-21
  "financeManager",      // finance oversight -- ADDED 2026-08-21, the anomaly that prompted this
  "accountingManager",   // enterprise finance
  "controller",          // enterprise finance
  "fieldManager",        // service organization
  "salesManager",        // sales organization
  "partsManager",        // parts organization
  "warehouseManager",    // warehouse / enterprise inventory
  "shopManager",         // service organization
];

// Roles that must NEVER pick up audit read without a new, explicit Owner decision. Associates and
// individual contributors do the work the audit trail records; reading it is their manager's job.
const MUST_NOT_READ_AUDIT = [
  "shopAssociate",       // REMOVED 2026-08-21 by Owner decision
  "partsAssociate",      // REMOVED 2026-08-21 -- same drift, same reasoning, one row the Owner's
                         // ruling did not name individually but whose category it named exactly
  "warehouseAssociate",  // never had it; the matrix's own inconsistency that exposed the artifact
  "salesperson",
  "supportStaff",
  "generalEmployee",
  "marketingManager",    // no audit row and no oversight claim over recorded operations
  "officeManager",
];

test("audit read is held by exactly the management Roles the Owner approved", () => {
  const actual = Object.values(GOVERNED_BUSINESS_ROLES)
    .filter((r) => (r.permissions || []).includes(AUDIT_READ))
    .map((r) => r.id).sort();
  assert.deepEqual(
    actual, [...APPROVED_AUDIT_READERS].sort(),
    "audit.event.read holders changed.\n\nDECISION (Owner, 2026-08-21): audit read is reconciled "
    + "toward MANAGEMENT OVERSIGHT. It was removed from shopAssociate and partsAssociate and added "
    + "to operationsManager and financeManager. Adding a holder is an Owner decision to make "
    + "explicitly -- amend this list and say why, rather than letting a matrix row or a copied "
    + "permission block widen oversight silently.",
  );
});

test("audit read never drifts onto an associate or individual-contributor Role", () => {
  // Stated separately from the exact-set check on purpose. The exact set answers "who has it"; this
  // answers "who must never get it", and it keeps meaning something if the approved list is later
  // extended for a legitimate management Role.
  for (const id of MUST_NOT_READ_AUDIT) {
    const role = GOVERNED_BUSINESS_ROLES[id];
    assert.ok(role, `${id} must exist for this check to mean anything`);
    assert.equal(
      role.permissions.includes(AUDIT_READ), false,
      `${id} holds ${AUDIT_READ}. Associates and individual contributors perform the work the audit `
      + `trail records; reading that trail is oversight and belongs to their management. The `
      + `canonical matrix grants Audit Log R to shopAssociate and partsAssociate -- that row is `
      + `SUPERSEDED by the Owner decision of 2026-08-21 and must not be re-derived from it.`,
    );
  }
});

test("audit read confers no security administration", () => {
  // The separation that makes the grant safe to widen. If reading the audit log ever implied
  // administering access, the correct reaction would be to restrict readers rather than accept it.
  for (const id of APPROVED_AUDIT_READERS) {
    if (id === "owner") continue; // owner composes from admin and legitimately holds admin.*
    const role = GOVERNED_BUSINESS_ROLES[id];
    const adminIds = role.permissions.filter((c) => c.startsWith("admin."));
    assert.deepEqual(
      adminIds, [],
      `${id} reads audit history AND holds ${adminIds.join(", ")}. Audit read is oversight; it must `
      + `stay distinct from role assignment and capability administration.`,
    );
  }
});

test("the approved-reader list cannot be quietly emptied or inverted", () => {
  assert.ok(APPROVED_AUDIT_READERS.length >= 8, "the approved list must not be gutted to make a change pass");
  assert.ok(MUST_NOT_READ_AUDIT.length >= 5, "the forbidden list must not be gutted");
  for (const id of APPROVED_AUDIT_READERS) {
    assert.ok(GOVERNED_BUSINESS_ROLES[id], `${id} must be a real Role`);
  }
  // No Role may appear on both lists -- an overlap would make one of them silently inert.
  const overlap = APPROVED_AUDIT_READERS.filter((id) => MUST_NOT_READ_AUDIT.includes(id));
  assert.deepEqual(overlap, [], "a Role cannot be both approved for and forbidden audit read");
  // Compatibility roles are out of scope by Owner ruling, but assert dispatcher/technician did not
  // acquire it, since they are the Roles most workers actually carry.
  for (const id of ["dispatcher", "technician"]) {
    assert.equal(
      (COMPATIBILITY_ROLES[id]?.permissions || []).includes(AUDIT_READ), false,
      `compatibility Role ${id} must not carry audit read`,
    );
  }
});
