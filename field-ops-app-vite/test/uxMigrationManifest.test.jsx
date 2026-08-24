// THE MIGRATION MANIFEST — a checkbox nobody can tick by hand.
//
// GOVERNANCE: docs/releases/ux-sandbox-release.md, Owner correction 2026-08-24.
//
// A release report claimed six object lists had shipped filters, sort and URL state. Two had. The
// report was written from what had been BUILT rather than what was MOUNTED, and nothing in the
// repository could tell the difference.
//
// These tests are that difference. They read the real screen files, so a list that stops mounting
// the canonical runtime fails here — and a list that never mounted it cannot be reported as shipped.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  UX_MIGRATION_OBJECTS,
  MOUNT_EVIDENCE,
  evaluateMigration,
  evaluateAllMigrations,
  withEnvironmentEvidence,
} from "../src/metadata/uxMigrationManifest.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const results = () => evaluateAllMigrations(read);
const byId = (id) => results().find((r) => r.objectId === id);

describe("the manifest describes real files", () => {
  it("every declared screen and definition exists", () => {
    for (const entry of UX_MIGRATION_OBJECTS) {
      expect(existsSync(path.resolve(process.cwd(), entry.screen)), entry.screen).toBe(true);
      expect(existsSync(path.resolve(process.cwd(), entry.definition)), entry.definition).toBe(true);
    }
  });

  it("an unreadable screen is CONTRACT_ONLY, never a pass", () => {
    // A file that cannot be read is not evidence of anything. This is the direction that matters:
    // a missing screen must never round up.
    const r = evaluateMigration({ objectId: "ghost", screen: "src/does/not/exist.jsx" }, read);
    expect(r.status).toBe("CONTRACT_ONLY");
    expect(r.screenMissing).toBe(true);
  });
});

// ═════════════════════════════════════════ the migrated lists

describe("lists that mount the canonical runtime", () => {
  for (const id of ["account", "part", "salesOrder", "workOrder", "equipment"]) {
    it(`${id} is MERGED_UI with every required control`, () => {
      const r = byId(id);
      expect(r.status).toBe("MERGED_UI");
      for (const key of ["controls", "urlState", "addFilter", "sort", "activeCriteria"]) {
        expect(r.mounts[key], `${id} must mount ${MOUNT_EVIDENCE[key]}`).toBe(true);
      }
    });
  }

  it("Part Master now renders phone cards, like every other migrated list", () => {
    // It was the last one compressing eight columns into ~320px: nothing overflowed, which is why a
    // geometry pass missed it, and nothing was readable either.
    expect(byId("part").cards).toBe(true);
  });

  it("Accounts and Sales Orders render through the shared grid", () => {
    expect(byId("account").cards).toBe(true);
    expect(byId("salesOrder").cards).toBe(true);
  });
});

// ═════════════════════════════════════════ the honest negatives

describe("lists that have NOT been migrated say so", () => {
  // These are not failures of this test — they are the current truth, pinned so it cannot be
  // reported otherwise. When each is migrated, its line moves to the block above.
  for (const id of ["purchaseOrder"]) {
    it(`${id} is CONTRACT_ONLY — metadata exists, the screen does not mount it`, () => {
      expect(byId(id).status).toBe("CONTRACT_ONLY");
    });
  }
});

// ═════════════════════════════════════════ status cannot be promoted by assertion

describe("status derives from evidence", () => {
  it("environment evidence can only RAISE a status source already earned", () => {
    const contractOnly = { objectId: "x", status: "CONTRACT_ONLY", mounts: {}, cards: false };
    // A list that does not mount the runtime cannot become live-verified by claiming it was.
    expect(withEnvironmentEvidence(contractOnly, { deployed: true, liveVerified: true }).status)
      .toBe("CONTRACT_ONLY");
  });

  it("a merged list becomes DEPLOYED_UNVERIFIED, then LIVE_VERIFIED, only when told", () => {
    const merged = { objectId: "x", status: "MERGED_UI", mounts: {}, cards: true };
    expect(withEnvironmentEvidence(merged).status).toBe("MERGED_UI");
    expect(withEnvironmentEvidence(merged, { deployed: true }).status).toBe("DEPLOYED_UNVERIFIED");
    expect(withEnvironmentEvidence(merged, { deployed: true, liveVerified: true }).status).toBe("LIVE_VERIFIED");
  });

  it("MERGED_UI requires the WHOLE control set, not a majority", () => {
    // A filter builder with no URL state loses the person's work the moment they open a record.
    // That is a partly migrated list, and the manifest must not round it up.
    const partial = "AddFilter SortControl ActiveCriteria MetadataListControls";
    const r = evaluateMigration({ objectId: "x", screen: "x" }, () => partial);
    expect(r.mounts.urlState).toBe(false);
    expect(r.status).toBe("CONTRACT_ONLY");
  });
});

// ═════════════════════════════════════════ the gap that was lost, and is back

describe("Sales Order authority knowledge", () => {
  it("SALES_ORDER_TOTAL_AUTHORITY_GAP is CLOSED, with the wrong call recorded", async () => {
    const { salesOrderEntity } = await import("../src/metadata/definitions/salesOrder.js");
    // It is no longer a live gap: it claimed the order carries no authoritative money, and the
    // billing engine disagrees.
    expect(salesOrderEntity.gaps.map((g) => g.id)).not.toContain("SALES_ORDER_TOTAL_AUTHORITY_GAP");
    // But it is not deleted either. A closed gap is the record of a decision, and this one is also
    // the record of a wrong call worth not repeating.
    const def = read("src/metadata/definitions/salesOrder.js");
    expect(def).toMatch(/CLOSED, AND WRONG WHILE IT WAS OPEN/);
    expect(def).toMatch(/PRICE_MISMATCH/);
    // The one real hazard survives the closure.
    expect(def).toMatch(/NULL IS NOT ZERO/);
  });

  it("the Sales Order DOES carry the money of the sale", async () => {
    // THIS ASSERTION USED TO SAY THE OPPOSITE. It encoded a conclusion drawn from a gap register
    // rather than from the billing engine, and the billing engine disagrees: invoiceCommands.ts
    // snapshots each line's `unitPrice` as `unitPriceMinor`, refuses to bill a line without one,
    // and refuses any invoice price that disagrees with it. The invoice is derived FROM the order.
    // Full evidence and the partial-pricing rule live in test/salesOrderMoney.test.jsx.
    const { salesOrderEntity } = await import("../src/metadata/definitions/salesOrder.js");
    expect(salesOrderEntity.fields.some((f) => f.id === "totalMinor")).toBe(true);
  });

  it("the Sales Order list offers only its ONE index-backed filter", async () => {
    const { salesOrderIndexList } = await import("../src/metadata/definitions/salesOrder.js");
    // sales_orders(state, salesOrderNumber DESC) is the only live composite for this collection.
    expect(salesOrderIndexList.filters.map((f) => f.fieldId)).toEqual(["state"]);
  });
});

// ═════════════════════════════════════════ the money-source finding

describe("Purchase Order money source", () => {
  it("the reachable PO list reads a collection that stores no money", () => {
    // PO LIST / MONEY SOURCE MISMATCH. `src/domain/constants.js` defines PURCHASE_ORDERS_COLLECTION
    // as "reorder_purchase_orders"; `functions/src/constants/collections.ts` defines the SAME NAME as
    // "purchase_orders". The screen reads the former; totalCost is written into the latter.
    const clientConst = read("src/domain/constants.js");
    expect(clientConst).toMatch(/PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders"/);

    const def = read("src/metadata/definitions/purchaseOrder.js");
    expect(def).toMatch(/no price\/amount\/total field of any kind/);
  });

  it("no Dollars field is declared on the Purchase Order entity", async () => {
    const { purchaseOrderEntity } = await import("../src/metadata/definitions/purchaseOrder.js");
    // Attaching a real total from a different collection to these rows would be worse than showing
    // nothing: the number would be genuine and belong to another record.
    expect(purchaseOrderEntity.fields.some((f) => /dollar|totalCost/i.test(f.id))).toBe(false);
  });
});
