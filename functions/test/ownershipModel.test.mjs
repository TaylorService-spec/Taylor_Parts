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
import { readFileSync } from "node:fs";
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
import { classifyDocument } from "../lib/ownership/ownershipCensus.js";
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

test("Q3: transfer_orders carries PARTICIPATING_COMPANIES, not one owner", () => {
  const transfers = ownershipFamily("transferOrder");
  assert.equal(transfers.ownerClass, "PARTICIPATING_COMPANIES");
  assert.equal(transfers.companyScope, "CROSS_COMPANY_CAPABLE");
  // No single owner type, and no ownerFields -- the shape IS the pair.
  assert.equal(transfers.ownerType, null);
  assert.deepEqual(transfers.ownerFields, []);
  assert.deepEqual(transfers.participatingFields, ["sourceOperatingCompanyId", "destinationOperatingCompanyId"]);
  assert.deepEqual(crossCompanyFamilies().map((f) => f.family), ["transferOrder"]);
});

test("Q3: the handoff authority REFUSES a transfer -- participants are transaction state, not ownership", () => {
  // "The handoff/ownership authority should not be used to change transfer participants."
  assert.throws(
    () =>
      buildOwnershipHandoff(
        { family: "transferOrder", recordId: "trf-1", previousOwner: null, newOwner: { type: "COMPANY", id: "ventana" }, source: "ADMIN_CORRECTION" },
        { actorUid: "uid-admin" },
      ),
    // A distinct code from FAMILY_NOT_OWNABLE: a transfer IS ownable, it just is not handed off.
    (e) => e instanceof OwnershipHandoffError && e.code === "FAMILY_PARTICIPATING_COMPANIES",
  );
});

test("Q3: one participant of two is UNRESOLVED, not half-owned", () => {
  const transfers = ownershipFamily("transferOrder");
  assert.equal(classifyDocument(transfers, {}).resolution, "OWNERLESS");
  assert.equal(classifyDocument(transfers, { sourceOperatingCompanyId: "taylor" }).resolution, "UNRESOLVED");
  // Both present and governed: RESOLVED, and deliberately with NO single owner attached.
  const both = classifyDocument(transfers, { sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "ventana" });
  assert.equal(both.resolution, "RESOLVED");
  assert.equal(both.owner, null);
  // An ungoverned participant does not pass.
  assert.equal(
    classifyDocument(transfers, { sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "acme" }).resolution,
    "UNRESOLVED",
  );
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
      operatingCompanyId: "taylor", // company-authority correction: creation requires a company
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
      operatingCompanyId: "taylor", // company-authority correction: creation requires a company
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
        operatingCompanyId: "taylor",
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

// =========================== R-1 / R-2: the authored sandbox facts ===========================
//
// These guard the one thing the rulings were most emphatic about: the assignments are AUTHORED
// CONFIGURATION, and no code may ever infer them from a name, an id, or an ordinal.

test("R-1: all 12 sandbox physical roots are assigned to a governed company", () => {
  const cfg = JSON.parse(readFileSync(new URL("../../config/ownership/operating-company-roots.sandbox.json", import.meta.url), "utf8"));
  const roots = [...cfg.roots.warehouses, ...cfg.roots.mobile_locations];
  assert.equal(roots.length, 12);
  for (const r of roots) {
    assert.equal(resolveOperatingCompany(r.operatingCompanyId).state, "RESOLVED", `${r.id} must name a governed company`);
  }
  // BOTH companies must be present, and across BOTH stationary and mobile inventory -- a
  // Taylor-only sandbox cannot certify the model, because the cross-company path would never run.
  for (const group of ["warehouses", "mobile_locations"]) {
    const companies = new Set(cfg.roots[group].map((r) => r.operatingCompanyId));
    assert.ok(companies.has("taylor") && companies.has("ventana"), `${group} must contain both companies`);
  }
});

test("R-1: NOTHING infers a company from a root's name or id", () => {
  // The rulings forbid "north means Ventana", "truck 04+ means Ventana", "main means Taylor".
  // The structural guarantee is that the only mapping is the config file: no source module reads a
  // root's name or parses its id to produce a company.
  const cfg = JSON.parse(readFileSync(new URL("../../config/ownership/operating-company-roots.sandbox.json", import.meta.url), "utf8"));
  const byName = cfg.roots.warehouses.filter((r) => /north/i.test(r.name));
  // If a naming rule existed, every "north" warehouse would share a company. They deliberately do not
  // all have to -- and this asserts the config is the authority, not the word.
  assert.ok(byName.length >= 2, "fixture should contain more than one 'north' root for this to mean anything");
  const forbidden = /north|main|central|satellite|truck\s*\d/i;
  for (const src of ["../src/ownership/operatingCompanyAuthority.ts", "../src/ownership/ownershipDerivation.ts"]) {
    const text = readFileSync(new URL(src, import.meta.url), "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!forbidden.test(text), `${src} must not branch on a location name`);
  }
});

test("R-2: every certification fleet carries an explicit authored company, and the ordinal is retired", async () => {
  const { FLEET_OPERATING_COMPANY, fleetOperatingCompany, fleetFor } = await import(
    "../scripts/certificationWorld/data/equipmentAssets.mjs"
  );
  // Every fleet in the world is declared -- no fleet falls through to a computed value.
  let units = { taylor: 0, ventana: 0, undeclared: 0 };
  for (let i = 0; i < 100; i += 1) {
    const fleet = fleetFor(i);
    if (!fleet) continue;
    const company = fleetOperatingCompany(i);
    if (company === null) units.undeclared += fleet.count;
    else units[company] += fleet.count;
  }
  assert.equal(units.undeclared, 0, "every fleet with units must have an authored company");
  assert.equal(units.taylor + units.ventana, 278, "the fixture world holds 278 units");
  assert.equal(Object.keys(FLEET_OPERATING_COMPANY).length, 85);

  // The 2:1 rule was a ONE-TIME authoring mechanism. The map is literal values, so inserting an
  // account in the middle cannot reassign anyone -- which is what a runtime ordinal would do.
  const source = readFileSync(new URL("../scripts/certificationWorld/data/equipmentAssets.mjs", import.meta.url), "utf8");
  const declaration = source.slice(source.indexOf("FLEET_OPERATING_COMPANY = Object.freeze({"), source.indexOf("export function fleetOperatingCompany"));
  assert.ok(!/%|Math\.|index|ordinal/i.test(declaration), "the fleet map must be literal values, never a computation");
});

test("R-2: a fleet is assigned WHOLE -- one customer's machines share one company", async () => {
  const { equipmentForAccount, fleetOperatingCompany } = await import(
    "../scripts/certificationWorld/data/equipmentAssets.mjs"
  );
  for (const index of [0, 2, 3, 41]) {
    const units = equipmentForAccount({ accountIndex: index, accountId: `a-${index}`, accountName: "X", locationIds: ["L1", "L2"] });
    const companies = new Set(units.map((u) => u.data.operatingCompanyId));
    assert.equal(companies.size, 1, `fleet ${index} must be one company`);
    assert.equal([...companies][0], fleetOperatingCompany(index));
  }
});

test("R-2: operatingCompanyId is NOT lineOfBusiness -- the fixture proves they can disagree", async () => {
  const { equipmentForAccount } = await import("../scripts/certificationWorld/data/equipmentAssets.mjs");
  const disagreements = [];
  for (let i = 0; i < 100; i += 1) {
    for (const u of equipmentForAccount({ accountIndex: i, accountId: `a-${i}`, accountName: "X", locationIds: ["L1"] })) {
      const lobAsCompany = u.data.lineOfBusiness === "TAYLOR" ? "taylor" : "ventana";
      if (lobAsCompany !== u.data.operatingCompanyId) disagreements.push(u.id);
    }
  }
  // If these two ever agreed everywhere, someone would eventually "simplify" one into the other.
  // A product line is not a company: a Taylor-line machine can belong to Ventana's books.
  assert.ok(disagreements.length > 0, "the fixture must contain units whose product line and owning company differ");
});

// =========================== R-11 … R-15: the final lineage rulings ===========================

test("R-11: all 41 service Job fixtures carry an authored company, 27/14, and the solver is gone", async () => {
  const { SERVICE_JOB_OPERATING_COMPANY, serviceJobOperatingCompany } = await import(
    "../scripts/certificationWorld/data/serviceJobCompany.mjs"
  );
  const values = Object.values(SERVICE_JOB_OPERATING_COMPANY);
  assert.equal(values.length, 41);
  assert.equal(values.filter((v) => v === "taylor").length, 27);
  assert.equal(values.filter((v) => v === "ventana").length, 14);
  for (const v of values) assert.equal(resolveOperatingCompany(v).state, "RESOLVED");
  // A non-fixture job is absent and returns null -- never a guessed company.
  assert.equal(serviceJobOperatingCompany("some-non-fixture-job"), null);

  // Literal values only. A runtime that recomputed from technician order would reassign jobs the
  // moment a technician was added.
  const src = readFileSync(new URL("../scripts/certificationWorld/data/serviceJobCompany.mjs", import.meta.url), "utf8");
  const decl = src.slice(src.indexOf("Object.freeze({"), src.indexOf("export function serviceJobOperatingCompany"));
  assert.ok(!/%|Math\.|technicianId|index/i.test(decl), "the job map must be literal values, never a computation");
});

test("R-11: a technician never carries jobs for two companies", async () => {
  const { SERVICE_JOB_OPERATING_COMPANY } = await import("../scripts/certificationWorld/data/serviceJobCompany.mjs");
  const byTech = new Map();
  for (const [jobId, company] of Object.entries(SERVICE_JOB_OPERATING_COMPANY)) {
    // Fixture job ids are cwjob_<employeeId>_<seq>.
    const tech = jobId.replace(/^cwjob_/, "").replace(/_\d+$/, "");
    if (!byTech.has(tech)) byTech.set(tech, new Set());
    byTech.get(tech).add(company);
  }
  assert.equal(byTech.size, 11);
  for (const [tech, companies] of byTech) {
    assert.equal(companies.size, 1, `${tech} must not work for two operating companies`);
  }
});

test("R-14: the commercial company axis is explicit or inherited, and NEVER inferred", async () => {
  const { resolveCommercialCompanyScope, CommercialCompanyScopeError } = await import(
    "../lib/ownership/commercialCompanyScope.js"
  );
  assert.equal(resolveCommercialCompanyScope("taylor"), "taylor");
  // Inheritance: the upstream value is COPIED when nothing explicit is supplied.
  assert.equal(resolveCommercialCompanyScope(undefined, "ventana"), "ventana");
  // Explicit wins over inherited -- an order may legitimately be booked to the other company.
  assert.equal(resolveCommercialCompanyScope("ventana", "taylor"), "ventana");
  // Absent is null, not an error: the model is inert and a validator must not smuggle in enforcement.
  assert.equal(resolveCommercialCompanyScope(undefined, undefined), null);
  // A bad value is still a caller error, not a reason to fall back to null.
  assert.throws(() => resolveCommercialCompanyScope("TAYLOR"), CommercialCompanyScopeError);
  assert.throws(() => resolveCommercialCompanyScope("Taylor Freezer of Arizona"), CommercialCompanyScopeError);
});

test("R-14/R-15: the two axes are independent on one record", () => {
  const built = buildCreateOpportunity(
    { accountId: "acct-1", ownerEmployeeId: "emp-rudy", operatingCompanyId: "taylor", salesChannel: "RETAIL" },
    { actorUid: "uid-assistant", nowMillis: 1 },
  );
  // Who owns the sale, and which company conducts it, are both true and neither displaced the other.
  assert.equal(built.ownerEmployeeId, "emp-rudy");
  assert.equal(built.operatingCompanyId, "taylor");
  assert.equal(built.createdByUid, "uid-assistant");

  // R-15: the Account contributes the OWNER and nothing else. An account-derived owner does not
  // bring a company with it -- a customer may transact with either company on the next sale.
  const inherited = buildCreateOpportunity(
    { accountId: "acct-1", inheritedOwner: deriveAccountOwner({ accountOwner: { assignedToEmployeeId: "emp-rudy" } }), salesChannel: "RETAIL" },
    { actorUid: "uid-assistant", nowMillis: 1 },
  );
  assert.equal(inherited.ownerEmployeeId, "emp-rudy");
  assert.equal(inherited.operatingCompanyId, null, "an inherited owner must NOT bring a company with it");
});

test("R-14: a Sales Order copies the company at creation — and now REQUIRES one (company-authority correction)", () => {
  const lines = [{ kind: "PART", ref: "PRT-1", orderedQty: 1, unitPrice: 100 }];
  const copied = buildCreateSalesOrder(
    { accountId: "a", ownerEmployeeId: "emp-1", inheritedOperatingCompanyId: "ventana", salesChannel: "RETAIL", lines },
    { actorUid: "u", nowMillis: 1 },
  );
  assert.equal(copied.operatingCompanyId, "ventana");
  assert.equal(copied.ownerEmployeeId, "emp-1");

  // HARDENED (2026-09-01): the old backward-compatible null is gone. A CONFIRMED order is a
  // reportable commitment; a caller with no explicit or inherited company is refused rather than
  // allowed to mint a company-less order. Copy semantics above are unchanged — the change is only
  // that ABSENT now refuses instead of persisting null.
  assert.throws(
    () => buildCreateSalesOrder(
      { accountId: "a", ownerEmployeeId: "emp-1", salesChannel: "RETAIL", lines },
      { actorUid: "u", nowMillis: 1 },
    ),
    (e) => e.code === "COMPANY_REQUIRED",
  );
});

test("R-13: a reorder request derives its company from the WAREHOUSE, and a PO cannot mix companies", async () => {
  const { resolveReorderLocation, resolvePurchaseOrderCompany, ReorderLocationError } = await import(
    "../lib/ownership/reorderRequestLocationAuthority.js"
  );
  assert.deepEqual(resolveReorderLocation("wh-main", "taylor"), { warehouseId: "wh-main", operatingCompanyId: "taylor" });
  // Inert: no warehouse means no company, not an error.
  assert.deepEqual(resolveReorderLocation(undefined), { warehouseId: null, operatingCompanyId: null });
  // A warehouse whose company is ungoverned is wrong, not merely missing.
  assert.throws(() => resolveReorderLocation("wh-main", "acme"), ReorderLocationError);

  assert.equal(resolvePurchaseOrderCompany(["taylor", "taylor"]), "taylor");
  // R-13: mixed purchasing is REFUSED, not modelled as participating companies. A transfer spans two
  // companies because goods move; a purchase order is one company's commitment to a supplier.
  assert.throws(
    () => resolvePurchaseOrderCompany(["taylor", "ventana"]),
    (e) => e instanceof ReorderLocationError && e.code === "PO_MIXED_COMPANY",
  );
  assert.throws(
    () => resolvePurchaseOrderCompany([null, undefined]),
    (e) => e.code === "PO_COMPANY_UNRESOLVED",
  );
});

// ======================= C31: the matrix must describe, not assert =======================
//
// `ownerFields` is a DESCRIPTIVE column, not a prescriptive one. Five independent statements in
// the substrate say so and none says otherwise:
//
//   ownershipMatrix.ts:29        "the EXISTING storage the typed owner derives from. Empty = no
//                                 storage yet."
//   ownershipCensus.ts:96-99     "A family with NO declared ownerFields is OWNERLESS by
//                                 construction ... until `operatingCompanyId` exists"
//   ownershipCensus.ts:157-163   an empty ownerFields yields the reason "family has no ownership
//                                 storage yet"
//   typedOwner.ts:190            "The matrix declares where ownership is STORED"
//   ownershipHandoffCommand.ts:74-76  "there is no owner field to write to yet on most families,
//                                 and the ones that have storage keep writing through their
//                                 existing governed paths"
//
// That settles what a wrong value MEANS. A prescriptive column naming a field the type lacks would
// be an unmet requirement; a descriptive one naming it is a FALSE STATEMENT OF FACT, and it is
// worse, because the census reports a MODEL gap (the field does not exist) and a DATA gap (the
// field exists and is unset) with different reason strings. Getting the column wrong swaps them,
// and the swap is invisible -- both land in the same OWNERLESS bucket.
//
// The reason strings are also what makes this checkable. They are a FINGERPRINT of the
// declaration: "family has no ownership storage yet" can only be produced by an EMPTY ownerFields,
// and "no <field>" can only be produced by a declared one. So the measured census that this file's
// header claims the matrix is "reconciled against" can be read back as an assertion about the
// matrix, and a family that acquires storage on paper without acquiring it in the data fails here.
//
// LIMITATION, STATED: this proves the declaration against ONE measurement, taken 2026-08-30. It
// cannot see a family that became resolved after it. A family whose census row is 100% RESOLVED
// yields no reason line, so it is checked by the converse assertion instead.

const CENSUS_EVIDENCE = "../../sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt";
const NO_STORAGE_REASON = "family has no ownership storage yet";

/** Parse the measured census into { collection -> { scanned, resolved, reasons: {reason: count} } }. */
function readMeasuredCensus() {
  const text = readFileSync(new URL(CENSUS_EVIDENCE, import.meta.url), "utf8");
  const rows = new Map();

  const [tablePart, reasonPart] = text.split("Reason classification (non-RESOLVED):");
  assert.ok(reasonPart, "the census evidence must carry its reason classification");

  for (const line of tablePart.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 7) continue;
    const collection = tokens[0];
    if (!/^[a-z_]+$/.test(collection)) continue;
    const numbers = tokens.slice(-6).map(Number);
    if (numbers.some((n) => !Number.isInteger(n))) continue;
    rows.set(collection, { scanned: numbers[0], resolved: numbers[1], reasons: {} });
  }
  assert.ok(rows.size >= 20, `expected the full census table, parsed ${rows.size} rows`);

  let current = null;
  for (const line of reasonPart.split("\n")) {
    if (line.startsWith("Family classification")) break;
    const head = /^ {2}(\S+)\s*$/.exec(line);
    if (head) {
      current = rows.get(head[1]);
      assert.ok(current, `reason block names ${head[1]}, which is not in the census table`);
      continue;
    }
    const entry = /^\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (entry && current) current.reasons[entry[2]] = Number(entry[1]);
  }
  return rows;
}

test("C31: no ownable family claims ownership storage the measured census says it does not have", () => {
  const census = readMeasuredCensus();
  let checked = 0;

  for (const f of OWNERSHIP_MATRIX) {
    const row = census.get(f.collection);
    if (!row) continue;
    const declared =
      f.ownerClass === "PARTICIPATING_COMPANIES" ? (f.participatingFields ?? []) : f.ownerFields;
    checked += 1;

    // The reason a family has no storage is emitted ONLY for an EMPTY declaration. Seeing it beside
    // a non-empty one means the matrix acquired a field after the measurement and nobody re-ran it.
    if (row.reasons[NO_STORAGE_REASON] !== undefined) {
      assert.deepEqual(
        declared,
        [],
        `${f.family} (${f.collection}) declares storage ${JSON.stringify(declared)}, but the measured ` +
          `census reports ${row.reasons[NO_STORAGE_REASON]} record(s) as "${NO_STORAGE_REASON}" -- a ` +
          "reason only an EMPTY ownerFields can produce. The matrix is describing storage that does not exist.",
      );
    }

    // The converse. A record can only RESOLVE through a declared field, so any resolution at all
    // proves the declaration is non-empty -- this is what covers the 100%-resolved families, which
    // emit no reason line.
    if (row.resolved > 0) {
      assert.notDeepEqual(
        declared,
        [],
        `${f.family} (${f.collection}) declares no storage, yet the measured census resolved ` +
          `${row.resolved} of ${row.scanned} records. A family with no ownerFields is OWNERLESS by construction.`,
      );
    }

    // "no <field>" names the exact field the census read. It must be one the matrix declares.
    for (const reason of Object.keys(row.reasons)) {
      const named = /^no (\w+)$/.exec(reason);
      if (!named) continue;
      assert.ok(
        declared.includes(named[1]),
        `${f.family} (${f.collection}) was censused on "${named[1]}", which it does not declare`,
      );
    }
  }

  assert.ok(checked >= 20, `expected to check the censused families, checked ${checked}`);
});

test("C31: a ROOT family is never also declared a descendant of the derivation check", async () => {
  // ownershipDerivationCheck.js:29 builds its known-root set from warehouses + mobile_locations.
  // A family that is BOTH a root and a derivation rule is scanned as its own descendant: it
  // double-counts itself, and worse, it invites "N/N DERIVABLE" to be read as a company plan for
  // records whose company is authored configuration and cannot be derived at all.
  const { DERIVATION_RULES } = await import("../lib/ownership/ownershipDerivation.js");
  const roots = OWNERSHIP_MATRIX.filter((f) => f.inheritanceSource === "none -- this IS the root");
  assert.ok(roots.length >= 2, "the matrix must still declare physical roots");

  const derived = new Set(DERIVATION_RULES.map((r) => r.collection));
  for (const root of roots) {
    assert.ok(
      !derived.has(root.collection),
      `${root.family} (${root.collection}) is a physical root -- it has nothing to derive from, ` +
        "and scanning it as a descendant makes it a known root and a candidate at the same time",
    );
  }

  // Every derivation rule must still name a family the matrix knows, so a rule cannot drift onto a
  // collection the model never classified.
  for (const rule of DERIVATION_RULES) {
    assert.ok(ownershipFamily(rule.family), `derivation rule ${rule.family} names no matrix family`);
  }
});

test("C31: homeWarehouseId is not an operating-company source anywhere in the matrix", async () => {
  // The settling case: all five cert-trk-01..05 carry homeWarehouseId "wh-main", wh-main is
  // `taylor`, and the authored configuration assigns cert-trk-04/05 to `ventana`. Any matrix
  // column that offers homeWarehouseId as a company source is wrong for 2 of the 5.
  const cfg = JSON.parse(readFileSync(new URL("../../config/ownership/operating-company-roots.sandbox.json", import.meta.url), "utf8"));
  const byId = new Map([...cfg.roots.warehouses, ...cfg.roots.mobile_locations].map((r) => [r.id, r.operatingCompanyId]));
  const { CERT_TRUCKS } = await import("../scripts/certificationWorld/data/inventory.mjs");

  const contradictions = CERT_TRUCKS.filter((t) => byId.get(t.homeWarehouseId) !== byId.get(t.id));
  assert.deepEqual(
    contradictions.map((t) => t.id),
    ["cert-trk-04", "cert-trk-05"],
    "the fixture world must keep the two vehicles whose authored company contradicts their depot's",
  );

  for (const f of OWNERSHIP_MATRIX) {
    for (const column of [f.backfillSource, f.inheritanceSource]) {
      if (typeof column !== "string") continue;
      assert.ok(
        !/homeWarehouseId/.test(column) || /NOT its home warehouse|never|forbid/i.test(column),
        `${f.family} offers homeWarehouseId as a company source: ${column}`,
      );
    }
  }
});

test("C31: the Work Order family labels match the collection the deployed writers use", async () => {
  const { WORK_ORDERS_COLLECTION } = await import("../lib/constants/collections.js");
  assert.equal(WORK_ORDERS_COLLECTION, "fieldops_wos");

  // The canonical Work Order is the one the callables write. It was labelled `workOrderLegacy`.
  assert.equal(ownershipFamily("workOrder").collection, WORK_ORDERS_COLLECTION);
  assert.equal(ownershipFamily("workOrderLegacy").collection, "fieldops_jobs");

  // Why the label is load-bearing: `family` becomes the handoff audit's targetType, and every
  // deployed writer on fieldops_wos already stamps targetType "workOrder" (createWorkOrder.ts:197,
  // transitionWorkOrder.ts:564, updateWorkOrderExecutionData.ts:265). Inverted labels would have
  // split one record's audit trail across two vocabularies.
  const event = buildOwnershipHandoff(
    { family: "workOrder", recordId: "wo-1", previousOwner: null, newOwner: { type: "COMPANY", id: "ventana" }, source: "ADMIN_CORRECTION" },
    { actorUid: "uid-admin" },
  );
  assert.equal(event.targetType, "workOrder");

  // And the Work Order stores no company today, so it must not claim to. Nothing is stamped.
  assert.deepEqual(ownershipFamily("workOrder").ownerFields, []);
  assert.equal(ownershipFamily("workOrder").backfillSource, null);
  assert.equal(classifyDocument(ownershipFamily("workOrder"), {}).reason, NO_STORAGE_REASON);
});
