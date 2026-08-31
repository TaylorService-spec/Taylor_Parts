// PARTS NORTH STAR P1v2 — the seven Owner rulings, made falsifiable.
//
// The Owner approved Design's P1v2 composition on 2026-08-31 "with authority corrections": seven
// rulings that override the frames where the frames asked for something the repository cannot
// truthfully supply, or asked to drop something operational. Frames are the acceptance authority
// for LOOK; these rulings are the acceptance authority where the two disagree, and the precedence
// the Owner set is explicit —
//
//   1. existing governed EOS business/domain authority
//   2. ND-25..ND-30, including the ND-30 amendment
//   3. these seven rulings
//   4. the P1v2 visual composition
//   5. existing implementation where Design is silent
//
// A DESIGN MOCKUP NEVER CREATES A FACT, CAPABILITY, MUTATION, PERMISSION, DERIVATION OR DATA
// RELATIONSHIP. Two elements in these frames would have needed one, and this suite is where that
// stays true after the next edit: the Activity actor (ruling 2) and Used on (ruling 3).
//
// WHY A SEPARATE SUITE. partsNorthStarRecord.test.jsx mocks inventoryAnalyticsEngine and asserts
// per-section behaviour; partsNorthStarWorkspace.test.mjs is node:test over source text. What is
// asserted here is the RULINGS, so that a future composition change has to come past them by name
// rather than by quietly rendering something the frames drew.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RECORD_SRC = fs.readFileSync(path.resolve("src/modules/inventory/PartDetail.jsx"), "utf8");
const LIST_SRC = fs.readFileSync(path.resolve("src/modules/inventory/PartsList.jsx"), "utf8");

// ── Ruling 2: the Activity band carries no actor and no description ─────────────────────────────
//
// Asserted against the PROJECTION rather than a rendered row, because the claim is about what can
// reach the surface at all: partActivityRows is the only thing the Activity band reads, so a field
// it cannot carry is a field no composition can draw. This is the same shape of proof the reorder
// point ruling uses — the arithmetic, not a description of it.
describe("ruling 2 — the ledger carries no actor and no description", () => {
  it("the activity projection exposes only the six governed ledger fields", async () => {
    const { partActivityRows } = await import("../src/domain/partsNorthStar.js");
    const [row] = partActivityRows([
      {
        id: "t1",
        partId: "P-1",
        workOrderId: "WO-9",
        type: "ADJUSTED",
        quantity: 6,
        timestamp: 1756000000000,
        // Fields a caller might hopefully attach. The ledger has none of them; neither may the row.
        actor: "D. Reyes",
        createdBy: "uid-123",
        description: "Opening adjustment",
        notes: "counted by hand",
      },
    ]);
    expect(Object.keys(row).sort()).toEqual(
      ["id", "quantity", "timestamp", "type", "typeIsKnown", "workOrderId"].sort()
    );
    for (const forbidden of ["actor", "createdBy", "description", "notes"]) {
      expect(row[forbidden], `partActivityRows must not carry ${forbidden}`).toBeUndefined();
    }
  });

  it("the record never reaches into inventory_actions for the Activity band's actor", () => {
    // The join the retirement of #1625 removed. `inventory_actions` IS still read on this page —
    // InventoryActionsPanel renders its own part-scoped history, which is legitimate and untouched.
    // What must never happen is that history feeding the GOVERNED LEDGER band, which is what
    // "Opening adjustment · D. Reyes" in frame 1b would have required.
    const activityBand = RECORD_SRC.slice(
      RECORD_SRC.indexOf('id="part-activity"'),
      RECORD_SRC.indexOf("INVENTORY ACTION HISTORY stays on the RECORD")
    );
    expect(activityBand.length).toBeGreaterThan(200);
    for (const f of ["useInventoryActions", "inventoryActionsStore", "createdBy", "row.actor"]) {
      expect(activityBand.includes(f), `the Activity band must not reference ${f}`).toBe(false);
    }
  });
});

// ── Ruling 3: Used on states that it is switched off, and does not populate ─────────────────────
describe("ruling 3 — Used on is a truthful absence, not a populated column", () => {
  it("the compatibility read is still gated on the inactive capability", async () => {
    const { canViewCompatibility, VIEW_CAPABILITY } = await import(
      "../src/domain/equipmentCompatibilitySection.js"
    );
    expect(VIEW_CAPABILITY).toBe("equipment.compatibility.view");
    // Granted to nobody today. Every shape a caller might pass must resolve to "no".
    for (const deps of [undefined, null, () => false, () => null, {}]) {
      expect(canViewCompatibility(deps)).toBe(false);
    }
  });

  it("the record renders the absence sentence, and never the frame's reassurance line", () => {
    // Frame 1b draws "From the existing compatibility catalog." beneath a populated Used on. That
    // sentence is true of the CATALOGUE and false of the READ — exactly the distinction ND-27 drew
    // for locations — so it must not appear while the capability is off.
    expect(RECORD_SRC).toContain("not an empty list, it is an unread one");
    expect(RECORD_SRC).not.toContain("From the existing compatibility catalog");
  });
});

// ── Ruling 4: two rows left the record, and the domain behaviour did not ────────────────────────
describe("ruling 4 — Recommended reorder qty and Risk left the RECORD, not the domain", () => {
  it("neither row is rendered on the record any more", () => {
    expect(RECORD_SRC).not.toContain("<td>Recommended reorder qty</td>");
    expect(RECORD_SRC).not.toContain("<td>Risk</td>");
  });

  it("the reorder command still receives the whole recommendation, quantity included", async () => {
    // THE POINT OF THE RULING: an intentional PRESENTATION removal. If dropping the row had also
    // dropped the figure from the request, that would be a behaviour change the ruling forbids.
    const { generateReplenishmentRecommendation, calculateUsageRate } = await import(
      "../src/domain/inventoryAnalyticsEngine"
    );
    const now = 1756000000000;
    const usage = calculateUsageRate(
      "P-1",
      [3, 2, 4].map((quantity, i) => ({
        id: `t${i}`,
        partId: "P-1",
        workOrderId: "WO-1",
        type: "CONSUMED",
        quantity,
        timestamp: now - (i + 1) * 86400000,
      }))
    );
    // Stock of 0 against real consumption, so the engine actually recommends an order -- the point is
    // that the FIGURE still exists and still reaches the command, not that any stock level yields one.
    const recommendation = generateReplenishmentRecommendation("P-1", 0, usage);
    // The FIGURE still exists and is still a number the command can use. Deliberately not
    // "greater than zero": whether this particular stock level warrants an order is the engine's
    // business and its thresholds are free to change, while the claim under test is only that
    // removing the ROW did not remove the value.
    expect(Number.isFinite(recommendation.recommendedOrderQty)).toBe(true);
    expect(recommendation).toHaveProperty("urgency");
    // And the control is still handed the recommendation object itself, not a narrowed copy.
    expect(RECORD_SRC).toContain("recommendation={health.recommendation}");
  });
});

// ── Ruling 5: pagination survives, and the count never claims the page is the catalogue ─────────
describe("ruling 5 — the collection is still paged, and says so", () => {
  it("the pager is still rendered", () => {
    expect(LIST_SRC).toContain("Previous");
    expect(LIST_SRC).toContain("Next");
  });

  it("the footer states the range as well as the total", () => {
    // Frame 1a's footer reads "62 parts" over an unpaged list. This list IS paged and the
    // production catalogue is ~1,400 parts, so a bare total over 25 rows would tell the reader the
    // page is the catalogue.
    expect(LIST_SRC).toMatch(/Showing \{/);
    expect(LIST_SRC).toContain("of {filteredParts.length}");
  });
});

// ── Ruling 6: the qualified view label outranks the frame ───────────────────────────────────────
describe("ruling 6 — the views say 'Active parts', not 'Active'", () => {
  it("the collection view keeps its ADR-012 §2.2a qualifier", async () => {
    const { partsCollectionViews } = await import("../src/domain/partsNorthStar.js");
    const labels = partsCollectionViews([], new Map()).map((v) => v.label);
    expect(labels).toEqual(["All", "Active parts", "Needs attention", "Serialized"]);
  });
});

// ── Ruling 7: the primary action leads, at both widths ──────────────────────────────────────────
describe("ruling 7 — Edit part is primary and comes first", () => {
  it("the record's action pair is ordered and weighted, once, for both widths", () => {
    const edit = RECORD_SRC.indexOf('variant="primary" onClick={() => setMasterDataPanel("edit")}');
    const status = RECORD_SRC.indexOf('setMasterDataPanel("status")');
    expect(edit).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(-1);
    expect(edit).toBeLessThan(status);
    // ONE declaration, so responsive layout cannot reverse the hierarchy — it may restack only.
    expect(RECORD_SRC.split('setMasterDataPanel("edit")').length - 1).toBe(1);
  });
});

// ── The ND-30 amendment: subordinate, but present and whole ─────────────────────────────────────
describe("the ND-30 amendment — Work and Flow are subordinate, not removed", () => {
  it("both groups still render on /inventory, with their governed panels intact", () => {
    // Route ownership and functional presence are what the boundary protects. Every command surface
    // the Work group carried must still be reachable from this page.
    for (const component of [
      "InventoryHealthPanel",
      "ManagerQueuePanel",
      "RequestCards",
      "AssignedRequestDetail",
      "AssignedWorkOversightTable",
    ]) {
      expect(LIST_SRC.includes(`<${component}`), `${component} left the Parts workspace`).toBe(true);
    }
    expect(LIST_SRC).toContain('id="parts-group-work"');
    expect(LIST_SRC).toContain('id="parts-group-flow"');
  });

  it("the rail is the shell's own supporting region, not a second layout primitive", () => {
    // The handoff named a missing rail slot as an implementation seam. There was none:
    // WorkspaceShell already exposes `supporting` and a split body.
    expect(LIST_SRC).toContain("supporting={partsRail}");
  });

  it("a queue with work opens; an empty queue is one line", () => {
    // The frame draws every queue as a single summary line because its fixture has them empty. That
    // is the right RESTING state and the wrong permanent one — these panels carry governed commands,
    // and the amendment forbids removing their functions from this workspace.
    expect(LIST_SRC).toMatch(/open=\{queueEntries\.length > 0\}/);
    expect(LIST_SRC).toMatch(/open=\{partsManagerQueue\.length > 0\}/);
    expect(LIST_SRC).toMatch(/open=\{partsAssociateWaiting\.length > 0\}/);
    expect(LIST_SRC).toMatch(/open=\{partsAssociateInProgress\.length > 0\}/);
  });
});

// ── The read-checked line claims a read time and nothing more ───────────────────────────────────
describe("the crumb's right side is a read time, not a freshness claim", () => {
  it("it is stamped from the client's own resolved read", () => {
    expect(LIST_SRC).toContain("setReadCheckedAt(new Date())");
    // And it says "Read-checked", which is a statement about this client. Words that would claim
    // something about the records themselves are not used.
    expect(LIST_SRC).toContain("Read-checked");
    for (const overclaim of ["Up to date", "Last updated", "Live", "Current as of"]) {
      expect(LIST_SRC.includes(overclaim), `"${overclaim}" claims more than a read time`).toBe(false);
    }
  });
});
