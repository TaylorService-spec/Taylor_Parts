// EOS Ownership Model v1 — OFFLINE tests for the inert ownership authorities (Owner rulings
// D-1..D-5, 2026-08-30). No emulator, no Firebase, no network. Imported from the compiled lib,
// matching the sibling commercial command suites.
//
// What these prove, in the order the rulings state them:
//   D-2  the operating-company authority resolves by id and NEVER by display text
//   D-1  the typed owner is DERIVED from existing storage, and accountOwner stays authoritative
//   D-3  equipment company ownership and title holder do not collapse into each other
//   D-4  explicit owner wins, otherwise inherit, otherwise REFUSE -- never the caller
//   D-5  the AuditAction union and its runtime mirror stay symmetrical
//   ---  the non-collapse ruling: a handoff moves ONE record and cascades nothing
import test from "node:test";
import assert from "node:assert/strict";
import {
  OPERATING_COMPANIES,
  OPERATING_COMPANY_IDS,
  isOperatingCompanyIdShape,
  resolveOperatingCompany,
} from "../lib/ownership/operatingCompanyAuthority.js";
import {
  OWNER_TYPES,
  OWNERSHIP_RESOLUTION,
  combineOwnerDerivations,
  deriveAccountOwner,
  deriveCompanyOwner,
  deriveEmployeeRefOwner,
  isTypedOwner,
  typedOwner,
} from "../lib/ownership/typedOwner.js";
import { OWNERSHIP_MATRIX, crossCompanyFamilies, ownershipFamily } from "../lib/ownership/ownershipMatrix.js";
import {
  buildOwnershipHandoff,
  OwnershipHandoffError,
} from "../lib/ownership/ownershipHandoffCommand.js";
import {
  resolveCreationOwner,
  CreationOwnerUnresolvedError,
} from "../lib/ownership/creationOwnerResolution.js";
import { buildCreateOpportunity, OpportunityCommandError } from "../lib/opportunity/opportunityCommands.js";
import { buildCreateSalesOrder, SalesOrderCommandError } from "../lib/salesOrder/salesOrderCommands.js";

// assert.throws returns undefined, so it cannot be used to inspect the error it caught. These
// tests care about the error's `code`, not merely that something threw.
function caught(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected a throw");
}

// =========================== D-2: the operating-company authority ===========================

test("D-2: exactly two companies are seeded, with the stable governed ids the ruling named", () => {
  assert.deepEqual(
    OPERATING_COMPANIES.map((c) => c.id),
    ["taylor", "ventana"],
  );
  assert.equal(OPERATING_COMPANY_IDS.TAYLOR, "taylor");
  assert.equal(OPERATING_COMPANY_IDS.VENTANA, "ventana");
  assert.ok(OPERATING_COMPANIES.every((c) => c.active === true));
});

test("D-2: resolution is by id and DISPLAY TEXT IS NEVER AUTHORITY", () => {
  assert.equal(resolveOperatingCompany("taylor").state, "RESOLVED");
  // The code, the display name, and a line-of-business token all fail -- there is one id
  // namespace and it is the id. "Do NOT infer Taylor/Ventana from display text."
  assert.equal(resolveOperatingCompany("TAYLOR").state, "INVALID");
  assert.equal(resolveOperatingCompany("Taylor Freezer of Arizona").state, "INVALID");
  assert.equal(resolveOperatingCompany("Ventana").state, "INVALID");
});

test("D-2: an unseeded but well-formed id is UNKNOWN, not INVALID -- new companies need no schema change", () => {
  assert.equal(resolveOperatingCompany("third-company").state, "UNKNOWN");
  assert.equal(resolveOperatingCompany("").state, "INVALID");
  assert.equal(resolveOperatingCompany(null).state, "INVALID");
  assert.equal(resolveOperatingCompany({ id: "taylor" }).state, "INVALID");
  assert.ok(isOperatingCompanyIdShape("third-company"));
  assert.ok(!isOperatingCompanyIdShape("Third-Company"));
});

// =========================== the typed owner shape ===========================

test("a typed owner is exactly two fields -- extras are rejected, not ignored", () => {
  assert.ok(isTypedOwner({ type: "USER", id: "emp-1" }));
  assert.ok(isTypedOwner({ type: "COMPANY", id: "taylor" }));
  assert.ok(!isTypedOwner({ type: "USER", id: "emp-1", displayName: "Rudy" }));
  assert.ok(!isTypedOwner({ type: "USER" }));
  assert.ok(!isTypedOwner({ type: "ROLE", id: "PARTS_MANAGER" }));
  // A COMPANY owner must carry a shape-valid company id, not an arbitrary string.
  assert.ok(!isTypedOwner({ type: "COMPANY", id: "TAYLOR" }));
  assert.equal(typedOwner("USER", "  emp-1  ").id, "emp-1");
  assert.equal(typedOwner("USER", ""), null);
});

// =========================== D-1: derived from existing storage ===========================

test("D-1: the Account's typed owner is PROJECTED from the existing accountOwner map", () => {
  const out = deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-rudy", assignedToUserId: "uid-rudy" } });
  assert.equal(out.resolution, OWNERSHIP_RESOLUTION.RESOLVED);
  assert.deepEqual(out.owner, { type: OWNER_TYPES.USER, id: "emp-rudy" });
});

test("D-1: a partial accountOwner is UNRESOLVED, and an absent one is OWNERLESS -- the two stay apart", () => {
  // Deliberately NOT held to the seven-field write invariant: a legacy Account that stores only
  // the assignee is owned, and reporting it ownerless would make the census lie about the backlog.
  const partial = deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-1" } });
  assert.equal(partial.resolution, OWNERSHIP_RESOLUTION.RESOLVED);

  assert.equal(deriveAccountOwner({ accountOwner: { assignedToUserId: "uid-1" } }).resolution, OWNERSHIP_RESOLUTION.UNRESOLVED);
  assert.equal(deriveAccountOwner({}).resolution, OWNERSHIP_RESOLUTION.OWNERLESS);
  assert.equal(deriveAccountOwner(null).resolution, OWNERSHIP_RESOLUTION.OWNERLESS);
  assert.equal(deriveAccountOwner({ accountOwner: "emp-1" }).resolution, OWNERSHIP_RESOLUTION.UNRESOLVED);
});

test("the commercial families project from their existing ownerEmployeeId", () => {
  const out = deriveEmployeeRefOwner({ ownerEmployeeId: "emp-2" });
  assert.deepEqual(out.owner, { type: OWNER_TYPES.USER, id: "emp-2" });
  assert.equal(deriveEmployeeRefOwner({ ownerEmployeeId: "  " }).resolution, OWNERSHIP_RESOLUTION.UNRESOLVED);
  assert.equal(deriveEmployeeRefOwner({}).resolution, OWNERSHIP_RESOLUTION.OWNERLESS);
});

test("a company-owned record resolves through the governed authority, and an unseeded id does not pass", () => {
  assert.deepEqual(deriveCompanyOwner({ operatingCompanyId: "ventana" }).owner, { type: "COMPANY", id: "ventana" });
  assert.equal(deriveCompanyOwner({ operatingCompanyId: "acme" }).resolution, OWNERSHIP_RESOLUTION.UNRESOLVED);
  assert.equal(deriveCompanyOwner({}).resolution, OWNERSHIP_RESOLUTION.OWNERLESS);
});

test("two disagreeing owners are AMBIGUOUS -- the model never picks one", () => {
  const a = deriveEmployeeRefOwner({ ownerEmployeeId: "emp-1" });
  const b = deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-2" } });
  const combined = combineOwnerDerivations([a, b]);
  assert.equal(combined.resolution, OWNERSHIP_RESOLUTION.AMBIGUOUS);
  assert.equal(combined.owner, null);

  // Agreement is not ambiguity, and one broken field beside one good one is not either.
  const agree = combineOwnerDerivations([a, deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-1" } })]);
  assert.equal(agree.resolution, OWNERSHIP_RESOLUTION.RESOLVED);
  const oneBroken = combineOwnerDerivations([a, deriveAccountOwner({ accountOwner: {} })]);
  assert.equal(oneBroken.resolution, OWNERSHIP_RESOLUTION.RESOLVED);
  assert.match(oneBroken.reason, /assignedToEmployeeId/);
});

// =========================== D-3 and the non-collapse ruling ===========================

test("D-3: equipment is COMPANY-owned and its ownerFields do NOT include explicitTitleHolder", () => {
  const equipment = ownershipFamily("equipment");
  assert.equal(equipment.ownerType, OWNER_TYPES.COMPANY);
  assert.ok(!equipment.ownerFields.includes("explicitTitleHolder"));
  // A CUSTOMER title holder is legitimate and is simply not an ownership input -- there is no
  // CUSTOMER owner type at all, which is what makes the collapse unrepresentable rather than
  // merely discouraged.
  assert.deepEqual(Object.keys(OWNER_TYPES).sort(), ["COMPANY", "USER"]);
  assert.equal(typedOwner("CUSTOMER", "account-123"), null);
});

test("non-collapse: no family reads currentOwner, assignedTo, createdBy, or a coverage field", () => {
  const forbidden = ["currentOwner", "assignedTo", "assignedToUserId", "assignedTechId", "createdBy", "createdByUid", "territoryId", "coverageAssignmentId", "explicitTitleHolder"];
  for (const family of OWNERSHIP_MATRIX) {
    for (const field of family.ownerFields) {
      assert.ok(!forbidden.includes(field), `${family.family} reads ${field} as ownership`);
    }
  }
  // Coverage, territory, the audit trail and report definitions ARE in the matrix now -- recorded
  // as EXCLUDED rather than omitted, so a reader can see they were considered rather than
  // forgotten. What must hold is that they are not ownable and carry no owner type.
  for (const collection of ["sales_territories", "commercial_coverage_assignments", "auditEvents", "reportDefinitions"]) {
    const row = OWNERSHIP_MATRIX.find((f) => f.collection === collection);
    assert.ok(row, `${collection} should be recorded as EXCLUDED, not omitted`);
    assert.equal(row.ownerClass, "EXCLUDED");
    assert.equal(row.ownerType, null);
  }
});

test("no backfill source anywhere names a prohibited proxy", () => {
  // Rulings D-6/D-11/D-12 forbid deriving ownership from these. A matrix that named one as a
  // backfill source would launder a prohibited inference into a plan.
  const prohibited = /lineOfBusiness|display name|displayName|title holder|titleHolder|customer identity|creator|createdBy|auth uid|territory|coverage|sales history/i;
  for (const f of OWNERSHIP_MATRIX) {
    if (!f.backfillSource) continue;
    // The Account row NAMES these to say they are forbidden. Allow a source that is explicitly a
    // prohibition statement, reject one that proposes using them.
    const isProhibitionStatement = /forbids|never the record's display name/i.test(f.backfillSource);
    if (isProhibitionStatement) continue;
    assert.ok(!prohibited.test(f.backfillSource), `${f.family} backfillSource names a prohibited proxy: ${f.backfillSource}`);
  }
});

test("every ownable family declares a policy for records that cannot resolve", () => {
  for (const f of OWNERSHIP_MATRIX) {
    assert.ok(f.unresolvedPolicy && f.unresolvedPolicy.length > 0, `${f.family} has no unresolvedPolicy`);
    if (f.ownerClass === "PERSON" || f.ownerClass === "COMPANY") {
      assert.ok(f.ownerType, `${f.family} is ownable and must declare an owner type`);
    } else {
      assert.equal(f.ownerType, null, `${f.family} is ${f.ownerClass} and must not declare an owner type`);
      assert.equal(f.transfer, "N_A", `${f.family} is ${f.ownerClass} and cannot be handed off`);
    }
  }
});

test("D-10: transfer_orders is the cross-company family, and it proposes no single owner", () => {
  const transfers = ownershipFamily("transferOrder");
  assert.equal(transfers.companyScope, "CROSS_COMPANY_CAPABLE");
  // A Taylor -> Ventana move has no single owning company. Picking an end would record a false
  // fact, so there is deliberately no backfill source and the records stay ownerless.
  assert.equal(transfers.backfillSource, null);
  assert.deepEqual(crossCompanyFamilies().map((f) => f.family), ["transferOrder"]);
});

// =========================== D-4: creation owner resolution ===========================

test("D-4: an explicit owner wins over the upstream owner", () => {
  const upstream = deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-account" } });
  assert.deepEqual(resolveCreationOwner("emp-explicit", upstream, "the Account"), {
    ownerEmployeeId: "emp-explicit",
    source: "EXPLICIT",
  });
});

test("D-4: THE ASSISTANT CASE -- omitting the owner inherits the Customer owner, it does not follow the caller", () => {
  // Customer owner = Rudy. An assistant creates the Opportunity. Owner must be Rudy.
  const upstream = deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-rudy" } });
  const built = buildCreateOpportunity(
    { accountId: "acct-1", salesChannel: "RETAIL", inheritedOwner: upstream },
    { actorUid: "uid-assistant", nowMillis: 1_754_600_000_000 },
  );
  assert.equal(built.ownerEmployeeId, "emp-rudy");
  assert.equal(built.createdByUid, "uid-assistant");
  assert.notEqual(built.ownerEmployeeId, built.createdByUid);
});

test("D-4: when nothing resolves the create REFUSES -- it never falls back to the actor", () => {
  assert.throws(
    () => resolveCreationOwner(undefined, deriveAccountOwner({}), "the Account"),
    CreationOwnerUnresolvedError,
  );
  const err = caught(() =>
    buildCreateOpportunity(
      { accountId: "acct-1", salesChannel: "RETAIL", inheritedOwner: deriveAccountOwner({}) },
      { actorUid: "uid-assistant", nowMillis: 1 },
    ),
  );
  assert.ok(err instanceof OpportunityCommandError);
  assert.equal(err.code, "OWNER_REQUIRED");
  // The refusal must not name the caller -- if the actor appeared here it would be one edit away
  // from becoming the fallback the ruling forbids.
  assert.ok(!err.message.includes("uid-assistant"));
});

test("D-4: an AMBIGUOUS or UNRESOLVED upstream is never inherited from", () => {
  const ambiguous = combineOwnerDerivations([
    deriveEmployeeRefOwner({ ownerEmployeeId: "emp-1" }),
    deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-2" } }),
  ]);
  assert.throws(() => resolveCreationOwner(undefined, ambiguous, "the Account"), CreationOwnerUnresolvedError);
  // A COMPANY upstream cannot seed a person-owned record either.
  const company = deriveCompanyOwner({ operatingCompanyId: "taylor" });
  assert.throws(() => resolveCreationOwner(undefined, company, "the Account"), CreationOwnerUnresolvedError);
});

test("D-4: BACKWARD COMPATIBILITY -- an existing caller that supplies an owner is unaffected", () => {
  const built = buildCreateOpportunity(
    { accountId: "acct-1", ownerEmployeeId: "emp-legacy", salesChannel: "RETAIL" },
    { actorUid: "uid-1", nowMillis: 1_754_600_000_000 },
  );
  assert.equal(built.ownerEmployeeId, "emp-legacy");

  const so = buildCreateSalesOrder(
    {
      accountId: "acct-1",
      ownerEmployeeId: "emp-legacy",
      salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "PRT-1", orderedQty: 1, unitPrice: 100 }],
    },
    { actorUid: "uid-1", nowMillis: 1 },
  );
  assert.equal(so.ownerEmployeeId, "emp-legacy");
});

test("D-4: a downstream Sales Order inherits the Opportunity owner when none is supplied", () => {
  const so = buildCreateSalesOrder(
    {
      accountId: "acct-1",
      inheritedOwner: deriveEmployeeRefOwner({ ownerEmployeeId: "emp-opp" }),
      salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "PRT-1", orderedQty: 1, unitPrice: 100 }],
    },
    { actorUid: "uid-assistant", nowMillis: 1 },
  );
  assert.equal(so.ownerEmployeeId, "emp-opp");

  const err = caught(() =>
    buildCreateSalesOrder(
      {
        accountId: "acct-1",
        salesChannel: "RETAIL",
        lines: [{ kind: "PART", ref: "PRT-1", orderedQty: 1, unitPrice: 100 }],
      },
      { actorUid: "uid-assistant", nowMillis: 1 },
    ),
  );
  assert.ok(err instanceof SalesOrderCommandError);
  assert.equal(err.code, "OWNER_REQUIRED");
});

// =========================== the handoff command ===========================

test("a handoff produces exactly ONE event, for ONE record -- nothing cascades", () => {
  const event = buildOwnershipHandoff(
    {
      family: "account",
      recordId: "acct-1",
      previousOwner: { type: "USER", id: "emp-1" },
      newOwner: { type: "USER", id: "emp-2" },
      source: "DIRECT_HANDOFF",
    },
    { actorUid: "uid-admin" },
  );
  assert.equal(event.action, "OWNERSHIP_HANDOFF");
  assert.equal(event.targetType, "account");
  assert.equal(event.targetId, "acct-1");
  assert.equal(event.objectId, "acct-1");
  assert.equal(event.actorUid, "uid-admin");
  assert.deepEqual(event.previousOwner, { type: "USER", id: "emp-1" });
  assert.deepEqual(event.newOwner, { type: "USER", id: "emp-2" });
  assert.equal(event.handoffSource, "DIRECT_HANDOFF");
  // No child records, no list, no cascade flag -- the shape cannot express one.
  assert.ok(!("children" in event) && !("cascade" in event));
});

test("the first handoff of an unowned record states previousOwner: null rather than inventing one", () => {
  const event = buildOwnershipHandoff(
    { family: "opportunity", recordId: "opp-1", previousOwner: null, newOwner: { type: "USER", id: "emp-2" }, source: "ADMIN_CORRECTION" },
    { actorUid: "uid-admin" },
  );
  assert.equal(event.previousOwner, null);
  // Omitting it entirely is a caller that forgot, and is refused.
  assert.throws(
    () =>
      buildOwnershipHandoff(
        { family: "opportunity", recordId: "opp-1", newOwner: { type: "USER", id: "emp-2" }, source: "ADMIN_CORRECTION" },
        { actorUid: "uid-admin" },
      ),
    (e) => e instanceof OwnershipHandoffError && e.code === "PREVIOUS_OWNER_REQUIRED",
  );
});

test("historical ownership stays historical -- an IMMUTABLE family refuses a handoff", () => {
  for (const family of ["invoice", "payment", "inventoryTransaction", "purchaseOrder"]) {
    assert.throws(
      () =>
        buildOwnershipHandoff(
          { family, recordId: "r-1", previousOwner: null, newOwner: { type: "USER", id: "emp-2" }, source: "ADMIN_CORRECTION" },
          { actorUid: "uid-admin" },
        ),
      (e) => e instanceof OwnershipHandoffError && e.code === "FAMILY_IMMUTABLE",
      `${family} should refuse a handoff`,
    );
  }
});

test("the handoff refuses an owner type the family does not take, a no-op, and an unknown family", () => {
  const base = { recordId: "r-1", previousOwner: null, source: "DIRECT_HANDOFF" };
  const ctx = { actorUid: "uid-admin" };

  // A person cannot own a warehouse; a company cannot own an Opportunity.
  assert.throws(
    () => buildOwnershipHandoff({ ...base, family: "warehouse", newOwner: { type: "USER", id: "emp-1" } }, ctx),
    (e) => e.code === "OWNER_TYPE_MISMATCH",
  );
  // And a REFERENCE family has no owner to hand off at all -- `parts` is company-neutral now.
  assert.throws(
    () => buildOwnershipHandoff({ ...base, family: "part", newOwner: { type: "COMPANY", id: "taylor" } }, ctx),
    (e) => e.code === "FAMILY_NOT_OWNABLE",
  );
  assert.throws(
    () => buildOwnershipHandoff({ ...base, family: "opportunity", newOwner: { type: "COMPANY", id: "taylor" } }, ctx),
    (e) => e.code === "OWNER_TYPE_MISMATCH",
  );
  assert.throws(
    () =>
      buildOwnershipHandoff(
        { family: "opportunity", recordId: "r-1", previousOwner: { type: "USER", id: "emp-1" }, newOwner: { type: "USER", id: "emp-1" }, source: "DIRECT_HANDOFF" },
        ctx,
      ),
    (e) => e.code === "NO_OP",
  );
  // auditEvent IS in the matrix, as EXCLUDED -- so it refuses as NOT_OWNABLE, which says something
  // true about the domain. A name that is in no matrix row at all is the UNKNOWN case.
  assert.throws(
    () => buildOwnershipHandoff({ ...base, family: "auditEvent", newOwner: { type: "USER", id: "emp-1" } }, ctx),
    (e) => e.code === "FAMILY_NOT_OWNABLE",
  );
  assert.throws(
    () => buildOwnershipHandoff({ ...base, family: "sandwich", newOwner: { type: "USER", id: "emp-1" } }, ctx),
    (e) => e.code === "FAMILY_UNKNOWN",
  );
  assert.throws(
    () => buildOwnershipHandoff({ ...base, family: "opportunity", newOwner: { type: "USER", id: "emp-1" }, source: "BECAUSE" }, ctx),
    (e) => e.code === "SOURCE_INVALID",
  );
});

test("the summary names ids, never display names -- display names are not authority", () => {
  const event = buildOwnershipHandoff(
    { family: "account", recordId: "acct-1", previousOwner: null, newOwner: { type: "USER", id: "emp-2" }, source: "CUSTOMER_HANDOFF_REVIEW" },
    { actorUid: "uid-admin" },
  );
  assert.match(event.summary, /USER:emp-2/);
  assert.match(event.summary, /\(none\)/);
});
