// EVERY TRUSTED WRITE STAMPS THE ORDERED FIELDS, IN THE TYPE ITS METADATA GOVERNS.
//
// This replaces two client-side guards that died with `makeCollectionStore`:
// `collectionStoreTimestampContract.test.mjs` and `createdRecordIsReachable.test.mjs`. The STORE is
// gone; the two hazards it protected against are not, and both have been shipped as real defects
// before. They are restated here against the commands that now do the writing.
//
// ════════════════════ HAZARD 1 — ORDERBY SILENTLY EXCLUDES ════════════════════
//
// A newly created Prospect could not be found. It satisfied every filter on the Customers list and
// was absent from it, while remaining findable by name search. The cause has no error attached to
// it: Firestore's orderBy silently EXCLUDES any document missing the ordered field. The list sorts
// by `updatedAt DESC`; the writer stamped only `createdAt`. The record existed, matched, and was
// invisible. Nothing threw.
//
// ════════════════════ HAZARD 2 — TYPE ORDERING ════════════════════
//
// Firestore orders ACROSS TYPES BY TYPE FIRST. A number sorts BELOW every Timestamp, so a Customer
// created with epoch millis lands LAST under `updatedAt DESC` — on a paged list, indistinguishable
// from invisible. `accounts` governs these fields as TIMESTAMP; contacts, locations and equipment
// govern them as NUMBER.
//
// This migration reintroduced hazard 2 and was caught by the very test it was about to delete as
// obsolete. That is the reason this file exists rather than a note in a commit message.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountCreate,
  buildAccountUpdate,
  buildContactCreate,
  buildContactUpdate,
  buildLocationCreate,
  buildLocationUpdate,
} from "../lib/crm/crmWriteCommands.js";
import { buildEquipmentCreate, buildEquipmentUpdate } from "../lib/equipment/equipmentWriteCommands.js";
import { buildTechnician } from "../lib/workOrder/technicianCommands.js";

const NOW = 1_700_000_000_000;
const TYPED = { __timestamp: NOW };
const ACTOR = { actorUid: "uid-actor" };

/**
 * Every CREATE that lands in a list ordered by a timestamp, and the value it stamps.
 *
 * `expect` is the VALUE, not the type name, so a command that silently switched representation
 * fails here rather than in a paged list nobody is looking at.
 */
const CREATES = [
  {
    what: "account",
    build: () => buildAccountCreate({ name: "Acme" }, { ...ACTOR, nowValue: TYPED, mayWriteGovernedFields: false }),
    expect: TYPED,
    governs: "TIMESTAMP",
  },
  {
    what: "contact",
    build: () => buildContactCreate("acct-1", { name: "Ada" }, { ...ACTOR, nowMillis: NOW }),
    expect: NOW,
    governs: "NUMBER",
  },
  {
    what: "location",
    build: () => buildLocationCreate("acct-1", { label: "Site" }, { ...ACTOR, nowMillis: NOW }),
    expect: NOW,
    governs: "NUMBER",
  },
  {
    what: "equipment",
    build: () =>
      buildEquipmentCreate(
        { accountId: "acct-1", locationId: "loc-1", name: "Ice Machine" },
        { ...ACTOR, nowMillis: NOW, storedLocation: { accountId: "acct-1" } },
      ),
    expect: NOW,
    governs: "NUMBER",
  },
];

test("every CREATE stamps BOTH createdAt and updatedAt — orderBy excludes what is missing", () => {
  for (const { what, build, expect } of CREATES) {
    const out = build();
    assert.ok("createdAt" in out, `${what}: a record without createdAt is invisible to a createdAt sort`);
    assert.ok("updatedAt" in out, `${what}: a record without updatedAt is invisible to an updatedAt sort`);
    assert.equal(out.createdAt, expect, `${what}: createdAt`);
    assert.equal(out.updatedAt, expect, `${what}: updatedAt`);
  }
});

test("every CREATE stamps the TYPE its entity definition governs", () => {
  for (const { what, build, expect, governs } of CREATES) {
    const out = build();
    if (governs === "NUMBER") {
      assert.equal(typeof out.updatedAt, "number", `${what} governs NUMBER`);
    } else {
      assert.notEqual(typeof out.updatedAt, "number", `${what} governs TIMESTAMP — a number sorts below every one`);
      assert.equal(out.updatedAt, expect);
    }
  }
});

const UPDATES = [
  {
    what: "account",
    build: () => buildAccountUpdate({ name: "New" }, { name: "Old" }, { ...ACTOR, nowValue: TYPED, mayWriteGovernedFields: false }),
    expect: TYPED,
  },
  {
    what: "contact",
    build: () => buildContactUpdate({ name: "New" }, { name: "Old" }, { ...ACTOR, nowMillis: NOW }),
    expect: NOW,
  },
  {
    what: "location",
    build: () => buildLocationUpdate({ label: "New" }, { label: "Old" }, { ...ACTOR, nowMillis: NOW }),
    expect: NOW,
  },
  {
    what: "equipment",
    build: () =>
      buildEquipmentUpdate(
        { name: "Old", status: "ACTIVE", accountId: "a", locationId: "l" },
        { name: "New" },
        { ...ACTOR, nowMillis: NOW },
      ).patch,
    expect: NOW,
  },
];

test("every UPDATE refreshes updatedAt, so an edited record does not sink down a date-ordered list", () => {
  // The sibling of the create hazard, and it has its own history: an update that hardcoded its own
  // clock re-broke records that had been created correctly. Both stamps now come from one server
  // value per command, so create and update cannot disagree about the type.
  for (const { what, build, expect } of UPDATES) {
    const patch = build();
    assert.ok("updatedAt" in patch, `${what}: an update that does not refresh updatedAt strands the record`);
    assert.equal(patch.updatedAt, expect, `${what}: updatedAt`);
  }
});

test("no UPDATE rewrites createdAt — an edit is not a creation", () => {
  for (const { what, build } of UPDATES) {
    assert.equal("createdAt" in build(), false, `${what}: createdAt must survive an edit untouched`);
  }
});

test("a create that stamps no timestamp at all cannot pass this file", () => {
  // Guards the guard: a matcher that accepted a record with neither field would report a clean
  // contract it never checked.
  const noStamps = buildTechnician({ name: "Ada" });
  assert.equal("updatedAt" in noStamps, false);
  // buildTechnician is deliberately NOT in CREATES: fieldops_technicians has no timestamp fields
  // and no date-ordered list, so requiring them would invent a contract its definition never had.
  // Recorded here so the omission reads as a decision rather than an oversight.
});
