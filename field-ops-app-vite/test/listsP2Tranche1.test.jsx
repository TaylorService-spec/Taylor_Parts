// LISTS P2 TRANCHE 1 — the catalog / reference families.
//
// GOVERNANCE: docs/north-star/lists/, Owner continue-ruling 2026-08-27.
//
// Part Master · Equipment · Suppliers · Manufacturers. What these four share is that their honesty
// problems are all about COUNTING AND REACHING: what a footer may claim about a read's boundaries,
// what a tab may claim about a bucket, and whether a row is allowed to be clickable at all.
//
// The governing rule under test throughout:
//
//   LISTS MAY COMPOSE EXISTING GOVERNED FACTS / ACTIONS.
//   LISTS MAY NOT CREATE THE FACTS / READS / ROUTES / AUTHORITY NEEDED TO LOOK COMPLETE.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { partIndexList } from "../src/metadata/definitions/part.js";
import { equipmentIndexList } from "../src/metadata/definitions/equipment.js";
import { supplierIndexList } from "../src/metadata/definitions/supplier.js";
import { manufacturerIndexList } from "../src/metadata/definitions/manufacturer.js";
import { buildManufacturersPresentation } from "../src/modules/inventory/Manufacturers.jsx";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
/** Source with comments stripped — an assertion about absent CODE must not match the prose that
 *  explains the absence. That is the measurement bug the migration manifest exists to stop. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PART_MASTER = read("src/modules/inventory/PartMasterList.jsx");
const EQUIPMENT_WORKSPACE = read("src/modules/equipment/EquipmentWorkspace.jsx");
const CUSTOMER_EQUIPMENT = read("src/modules/equipment/CustomerEquipment.jsx");
const SUPPLIERS = read("src/modules/purchasing/Suppliers.jsx");
const MANUFACTURERS = read("src/modules/inventory/Manufacturers.jsx");

const ALL = [
  ["Part Master", PART_MASTER],
  ["Equipment", EQUIPMENT_WORKSPACE],
  ["Suppliers", SUPPLIERS],
  ["Manufacturers", MANUFACTURERS],
];

// ═════════════════════════════════════════ the shared grammar

describe("all four wear the collection header", () => {
  for (const [name, src] of ALL) {
    it(`${name} composes WorkspaceIdentity and hosts no WorkspaceShell`, () => {
      expect(src, name).toMatch(/import WorkspaceIdentity from/);
      expect(src, name).not.toMatch(/^import WorkspaceShell from/m);
      expect(src, name).not.toMatch(/^import ActionRail from/m);
    });
  }
});

// ═════════════════════════════════════════ Manufacturers — the Owner's specific ruling

describe("Manufacturers reads the whole collection, so it claims no boundary", () => {
  // OWNER RULING, tranche 1: "Render no pagination control/footer unless the governed read supports
  // it." getManufacturerCatalog takes no limit and no cursor and returns no `truncated` flag — there
  // is no page boundary to report, so any control implying one would be invented by the interface.

  it("the presentation reports hasMore FALSE, always", () => {
    for (const phase of ["loading", "denied", "error"]) {
      expect(buildManufacturersPresentation({ phase }).hasMore, phase).toBe(false);
    }
    const ready = buildManufacturersPresentation({
      phase: "ready",
      manufacturers: Array.from({ length: 400 }, (_, i) => ({ manufacturerId: `m${i}`, name: `M ${i}`, status: "ACTIVE" })),
    });
    // FOUR HUNDRED ROWS AND STILL NO MORE. Volume is not a page boundary: a read with no cursor
    // cannot have one, however many rows come back.
    expect(ready.rows).toHaveLength(400);
    expect(ready.hasMore).toBe(false);
  });

  it("the screen passes NO onLoadMore, so the affordance cannot render even if hasMore changed", () => {
    // Guarded in two places rather than one. The grid renders Load more only when hasMore AND
    // onLoadMore are both present.
    expect(code(MANUFACTURERS)).not.toMatch(/onLoadMore/);
  });

  it("nothing on the screen offers a page number, a total-pages or a pager", () => {
    const c = code(MANUFACTURERS);
    for (const invented of [/page \d/i, /of \d+ pages/i, /pager/i, /Load more/i, /Next page/i, /Previous/i]) {
      expect(c, `invented boundary: ${invented}`).not.toMatch(invented);
    }
  });

  it("the header count is exact BECAUSE the read is complete, and null when it is not", () => {
    // The one place an unbounded read is a licence rather than a liability: a count over every row
    // IS the collection count. It is still null on any unsettled read — "0 manufacturers" over a
    // denial states that the business has none when the truth is that this reader may not see them.
    expect(MANUFACTURERS).toMatch(/state\.phase === "ready" \? \(state\.manufacturers\?\.length \?\? null\) : null/);
  });

  it("no row navigation, because there is no Manufacturer record route", () => {
    expect(manufacturerIndexList.rowNavigationTo ?? null).toBeNull();
    expect(code(MANUFACTURERS)).not.toMatch(/onRowClick/);
    // The rows carry governed row ACTIONS instead — the affordance this object genuinely has.
    expect(MANUFACTURERS).toMatch(/rowActions/);
  });
});

// ═════════════════════════════════════════ Suppliers — counts only when the cursor is exhausted

describe("Suppliers counts a bucket only when it can count it exactly", () => {
  it("every per-bucket count is gated on a COMPLETE read", () => {
    // These four numbers are tallied from loaded rows. While pages are outstanding that is a claim
    // about a screenful presented as a claim about the business — the reason the Work Order status
    // chips gave up their counts. `hasMore === false` is not a guess: the cursor is exhausted, so
    // the tally is exact.
    expect(SUPPLIERS).toMatch(/const complete = presentation\.state === "READY" && !presentation\.hasMore/);
    expect(SUPPLIERS).toMatch(/const bucketCount = \(n\) => \(complete \? n : undefined\)/);
    for (const bucket of ["total", "active", "inactive", "ungoverned"]) {
      expect(SUPPLIERS, bucket).toMatch(new RegExp(`count: bucketCount\\(summary\\?\\.${bucket}\\)`));
    }
  });

  it("NO aggregate query was added to rescue the partial case", () => {
    // That would be creating a read to make the family look complete. The counts are absent on a
    // partial read instead, and the grid's Load more says what is true.
    expect(code(SUPPLIERS)).not.toMatch(/useListViewChrome|getCountFromServer/);
  });

  it("the summary line no longer needs its 'loaded so far' hedge, because it only renders complete", () => {
    // A sentence that has to explain that its own numbers might be partial is a sentence carrying
    // numbers it should not have.
    expect(code(SUPPLIERS)).not.toMatch(/loaded so far/);
    expect(SUPPLIERS).toMatch(/\{complete && summary && summary\.total > 0/);
  });

  it("no row navigation and no create action — neither exists for this object", () => {
    // supplierIndexList declares no rowNavigationTo and there is no per-supplier record route;
    // `suppliers` is Admin-SDK-write-only, so there is no client write path to offer either.
    expect(supplierIndexList.rowNavigationTo ?? null).toBeNull();
    expect(code(SUPPLIERS)).not.toMatch(/onRowClick/);
    expect(code(SUPPLIERS)).not.toMatch(/action=\{/);
  });
});

// ═════════════════════════════════════════ Part Master — the record it could never reach

describe("Part Master reaches its record, and keeps its frame while it cannot", () => {
  it("the row navigates to the route this application ACTUALLY mounts", () => {
    // This list is the reason the Phase 1 route check exists: the one MIGRATE family with a real
    // record page and no way to reach it from its own collection — over a declaration that named
    // "/parts/:id", which is not a route here.
    expect(partIndexList.rowNavigationTo).toBe("/inventory/:partId");
    expect(PART_MASTER).toMatch(/buildRowHref\(partIndexList\.rowNavigationTo, part\.partId\)/);
  });

  it("the identity cell is a REAL anchor and the row defers to it", () => {
    // What makes cmd-click, middle-click and open-in-new-tab work without reimplementing any of
    // them — and why the row is not given its own tabIndex, which would announce every row twice.
    expect(PART_MASTER).toMatch(/<Link to=\{buildRowHref/);
    expect(PART_MASTER).toMatch(/e\.target\.closest\("a, button"\)/);
    expect(PART_MASTER).toMatch(/e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/);
    expect(code(PART_MASTER)).not.toMatch(/tabIndex=\{0\}/);
  });

  it("a row-level click never fires through the Edit and Status buttons", () => {
    // They sit in the last cell. A row navigation firing through them would take somebody to the
    // record instead of the dialog they pressed.
    expect(PART_MASTER).toMatch(/closest\("a, button"\)/);
  });

  it("THE SHELL SURVIVES LOADING, DENIED AND UNAVAILABLE", () => {
    // All three used to return a bare paragraph — no crumb, no title, no rule pair. The page did
    // not merely lack content; it stopped being a page, so a slow read looked like a routing
    // accident and a denial looked like a broken screen.
    const c = code(PART_MASTER);
    expect(c).not.toMatch(/if \(state\.phase === "loading"\) return <p>/);
    expect(c).not.toMatch(/if \(state\.phase === "denied"\) return <p>/);
    expect(c).not.toMatch(/if \(state\.phase === "error"\) return <p>/);
    for (const state of ["LOADING", "DENIED", "UNAVAILABLE"]) {
      expect(PART_MASTER, state).toMatch(new RegExp(`HONEST_STATE\\.${state}`));
    }
  });

  it("an unsettled read shows NO count and NO create action", () => {
    // A count would be a claim about the catalogue drawn from a read that has not answered; a
    // create button over a denial offers a write to somebody who cannot even read.
    expect(PART_MASTER).toMatch(/if \(unsettled\) \{/);
    expect(PART_MASTER).toMatch(/NO COUNT AND NO ACTION ON AN UNSETTLED READ/);
  });

  it("its own Load more is unchanged — that read DOES have a cursor", () => {
    // The opposite of Manufacturers, and for the opposite reason: fetchPartMasterPage asks for one
    // document more than it shows, so "there is more" is something the query answered.
    expect(PART_MASTER).toMatch(/state\.hasMore &&/);
    expect(PART_MASTER).toMatch(/Load more parts/);
  });
});

// ═════════════════════════════════════════ Equipment — a count that would have been ambiguous

describe("Equipment: the workspace header carries no count, and that is the honest answer", () => {
  it("the workspace states identity only", () => {
    // Three tabs answer three different questions — the business-wide installed register, the
    // not-yet-connected serialized-asset surface, and an Account-scoped create flow. One number
    // beside one title would have to mean one of them, and a reader cannot tell which.
    // Re-anchored by the Equipment North Star P1v2.1, which added the locked 1a description
    // sentence to this same header. The CLAIM is unchanged, and it is the assertion below: this
    // header carries no count.
    expect(EQUIPMENT_WORKSPACE).toMatch(/<WorkspaceIdentity\s+crumb="Equipment"/);
    expect(EQUIPMENT_WORKSPACE).toMatch(/title="Equipment"/);
    expect(code(EQUIPMENT_WORKSPACE)).not.toMatch(/count=/);
  });

  it("the Customer Equipment tab keeps its own governed aggregate, where it is unambiguous", () => {
    expect(CUSTOMER_EQUIPMENT).toMatch(/useListViewChrome/);
    expect(CUSTOMER_EQUIPMENT).toMatch(/total=\{total\}/);
  });

  it("its row destination comes from the definition", () => {
    expect(equipmentIndexList.rowNavigationTo).toBe("/equipment/:equipmentId");
    expect(CUSTOMER_EQUIPMENT).toMatch(/buildRowHref\(equipmentIndexList\.rowNavigationTo, id\)/);
    expect(code(CUSTOMER_EQUIPMENT)).not.toMatch(/navigate\(`\/equipment\/\$\{id\}`\)/);
  });
});

// ═════════════════════════════════════════ the governing rule, checked as a whole

describe("the tranche created no authority", () => {
  it("no surface added a callable, a client-direct read, or a Rules-touching path", () => {
    for (const [name, src] of ALL) {
      const c = code(src);
      expect(c, `${name} must not call httpsCallable directly`).not.toMatch(/httpsCallable/);
      expect(c, `${name} must not query Firestore directly`).not.toMatch(/\bgetDocs\(|\bonSnapshot\(/);
    }
  });

  it("no synthetic record route was invented for the three families that have none", () => {
    // Suppliers, Warehouses and Manufacturers have no record page. Under the no-route rule a row
    // simply does not become a link, and no route is created to make one clickable.
    expect(supplierIndexList.rowNavigationTo ?? null).toBeNull();
    expect(manufacturerIndexList.rowNavigationTo ?? null).toBeNull();
  });
});
