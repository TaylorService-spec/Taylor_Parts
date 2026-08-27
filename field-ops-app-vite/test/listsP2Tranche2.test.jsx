// LISTS P2 TRANCHE 2 — the organization / location families.
//
// GOVERNANCE: docs/north-star/lists/, Owner continue-ruling 2026-08-27.
//
// Employees · Warehouses · Trucks. What these three share is that NONE of them has a record route,
// and the Owner ruling for this tranche is the sharpest constraint in the programme:
//
//   "Seven of these families currently have no record route. That is NOT authorization to create
//    seven routes. Row remains non-anchor / non-navigable where no legitimate destination exists.
//    Do not create dead hrefs. Do not link to unrelated workspaces as a fake detail destination.
//    A future record page is a separate product decision."
//
// So most of what follows asserts that something was NOT built. That is deliberate: the failure
// these tests exist to catch is a helpful one — somebody making rows clickable because every other
// family's rows are.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { employeeIndexList } from "../src/metadata/definitions/employee.js";
import { warehouseIndexList } from "../src/metadata/definitions/warehouse.js";
import { truckIndexList } from "../src/metadata/definitions/truck.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const EMPLOYEES = read("src/modules/administration/EmployeesList.jsx");
const WAREHOUSES = read("src/modules/inventory/Warehouses.jsx");
const TRUCKS = read("src/modules/inventory/TruckInventory.jsx");
const APP = read("src/App.jsx");

const ALL = [
  ["Employees", EMPLOYEES],
  ["Warehouses", WAREHOUSES],
  ["Trucks", TRUCKS],
];

describe("all three wear the collection header", () => {
  for (const [name, src] of ALL) {
    it(`${name} composes WorkspaceIdentity and hosts no WorkspaceShell`, () => {
      expect(src, name).toMatch(/import WorkspaceIdentity from/);
      expect(src, name).not.toMatch(/^import WorkspaceShell from/m);
    });
  }
});

// ═════════════════════════════════════════ the no-route rule

describe("no record route was created to make a row clickable", () => {
  it("none of the three declares a rowNavigationTo", () => {
    // The declaration is where a route would first appear, so it is where the absence is checked.
    for (const [name, def] of [["employee", employeeIndexList], ["warehouse", warehouseIndexList], ["truck", truckIndexList]]) {
      expect(def.rowNavigationTo ?? null, name).toBeNull();
    }
  });

  it("no screen wires a row click", () => {
    for (const [name, src] of ALL) {
      expect(code(src), name).not.toMatch(/onRowClick/);
    }
  });

  it("NO NEW ROUTE was added to App.jsx for any of them", () => {
    // The check that matters most, because it is the one a well-meaning follow-up would break.
    for (const invented of [/employees\/:/i, /warehouses\/:/i, /trucks\/:/i, /truck-inventory\/:/i]) {
      expect(APP, `App.jsx must not mount ${invented}`).not.toMatch(invented);
    }
  });

  it("no dead href and no fake destination", () => {
    // A row linking to an unrelated workspace to look navigable is worse than a row that does not
    // invite the click: it takes somebody somewhere and calls it the record.
    for (const [name, src] of ALL) {
      const c = code(src);
      expect(c, name).not.toMatch(/to="#"/);
      expect(c, name).not.toMatch(/href="#"/);
    }
  });

  it("Employees says WHY its rows are inert, rather than leaving it to be rediscovered", () => {
    expect(EMPLOYEES).toMatch(/no employee record page exists yet/);
    expect(EMPLOYEES).toMatch(/worse than one that does not invite the click/);
  });
});

// ═════════════════════════════════════════ counts

describe("a count is exact or it is absent", () => {
  it("Employees withholds its count while pages remain", () => {
    // A directory is where a partial count reads most convincingly as a complete one: "47
    // employees" sounds like a headcount.
    expect(EMPLOYEES).toMatch(/const complete = presentation\.state === "READY" && !presentation\.hasMore/);
    expect(EMPLOYEES).toMatch(/count=\{complete \? presentation\.rows\.length : null\}/);
  });

  it("Warehouses gates every per-bucket count on a complete read", () => {
    expect(WAREHOUSES).toMatch(/const complete = presentation\.state === "READY" && !presentation\.hasMore/);
    for (const bucket of ["total", "active", "inactive"]) {
      expect(WAREHOUSES, bucket).toMatch(new RegExp(`count: bucketCount\\(summary\\?\\.${bucket}\\)`));
    }
  });

  it("neither added an aggregate query to rescue the partial case", () => {
    // That would be creating a read to make the family look complete.
    for (const [name, src] of [["Employees", EMPLOYEES], ["Warehouses", WAREHOUSES]]) {
      expect(code(src), name).not.toMatch(/useListViewChrome|getCountFromServer/);
    }
  });

  it("the 'loaded so far' hedges are gone, because the sentences only render when complete", () => {
    expect(code(WAREHOUSES)).not.toMatch(/loaded so far/);
  });

  it("Trucks counts the whole fleet, because that read is not paged", () => {
    // The same licence Manufacturers has: a read with no cursor cannot have a page boundary, so a
    // count over its rows IS the collection count. `fleet.trucks` and `rows` are deliberately
    // different numbers — the governed fleet, and what the on-screen filters leave of it.
    expect(TRUCKS).toMatch(/count=\{fleet\.trucks\.length\}/);
  });

  it("no surface prints a zero where it means 'none to report'", () => {
    // "0 with discrepancies" reads as a reassurance the page has not earned.
    expect(TRUCKS).toMatch(/discrepancyTrucks > 0/);
    expect(WAREHOUSES).toMatch(/summary\?\.ungoverned > 0/);
  });
});

// ═════════════════════════════════════════ the frame

describe("the shell survives every state", () => {
  it("Trucks keeps its frame on DENIED and on ERROR, which it did not", () => {
    // Both returned a bare FailureState — no crumb, no title, no rule pair — so a denial read as a
    // broken screen rather than as a permission boundary.
    expect(TRUCKS).toMatch(/HONEST_STATE\.DENIED/);
    expect(TRUCKS).toMatch(/HONEST_STATE\.UNAVAILABLE/);
    expect(code(TRUCKS)).not.toMatch(/return <FailureState/);
  });

  it("a denial is not announced as a retryable error", () => {
    // FailureState carries role="alert". A denial is a fact about a role, and no retry changes it.
    expect(TRUCKS).toMatch(/state=\{HONEST_STATE\.DENIED\}/);
  });
});

// ═════════════════════════════════════════ the pane that stays

describe("the Truck detail pane is a named exception, not an oversight", () => {
  it("the pane remains, and the file says why", () => {
    // Lists P2 retires master-detail panes because the record has its own route. A Truck has none,
    // and this tranche's ruling is explicit that a missing record page is not a List defect and is
    // not authorisation to invent one. So the pane IS the record surface until that is decided as
    // its own product question — recorded here so it is not later "fixed" by adding a route.
    expect(TRUCKS).toMatch(/THE TRUCK RECORD, IN A PANE/);
    expect(TRUCKS).toMatch(/is not authorisation to invent/);
  });

  it("ContextBand is still composed — the header replaced the SHELL, not the band", () => {
    // They answer different questions: the header carries the fleet count and the discrepancy
    // signal, the band carries the per-truck facts a header count cannot express.
    expect(TRUCKS).toMatch(/import ContextBand from/);
    expect(TRUCKS).toMatch(/<ContextBand/);
  });

  it("no inferred live state — the workspace still computes nothing", () => {
    // The tranche ruling: "no inferred live state/location/assignment that the projection does not
    // own." Unchanged from before the migration, and re-checked because a shared grammar is where
    // a derived-looking column gets added.
    expect(TRUCKS).toMatch(/computes no inventory value, on-hand, reserved, available, reorder, or discrepancy/);
    expect(code(TRUCKS)).not.toMatch(/\bavailable\s*[:=]/i);
  });
});
