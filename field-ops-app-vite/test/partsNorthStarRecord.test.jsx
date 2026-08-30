// Parts North Star P1 — the record composition, made falsifiable.
//
// The Owner's rulings of 2026-08-30 are claims about what this page may say. Each is asserted here
// against the rendered output, because a ruling honoured only in a comment is not honoured.
//
//   ND-25  No quantity in the identity layer. The static baseline never appears as stock. The
//          ledger-derived forecast is named by its derivation and is not promoted into the header.
//   ND-26  The title is internalPartNumber. The document id is never a title or a label.
//   ND-27  No cost row and no price row, anywhere on the record.
//
// Plus the composition rules the North Star grammar imposes: four distinct honest states, sections
// that state why they are empty instead of drawing empty tables, a tracking-mode treatment per Part,
// a rail that does not repeat the header, and words where enums used to leak.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({ fetchPartMasterList: vi.fn() }));
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [{ sku: "TST-9001", name: "Static Name", category: "Valves", unit: "each", cost: 2480, price: 3999, reorderThreshold: 2, warehouseQty: 38 }],
  getCatalogItem: () => undefined,
}));
const ledger = { transactions: [], healthEntries: [], loading: false, error: null };
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ledger }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const r = () => ({ data: [], loading: false, hasMore: false, loadMore: () => {}, refresh: () => {}, error: null });
  return {
    useReorderRequestForPart: () => ({ data: null, loading: false, error: null, refresh: () => {} }),
    useReorderRequests: r, useReorderRequestsByStatus: r, useReorderRequestsByStatuses: r,
    useReorderRequestsAssignedTo: r, useReorderRequestsHistory: r, useReorderRequestById: r,
    fetchReorderRequestsHistoryPage: async () => ({ items: [], hasMore: false }),
  };
});
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => ({ byUserId: {}, loading: false }), resolveActorDisplayName: (id) => id }));
vi.mock("../src/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({ hasUsageHistory: () => false }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn(), getDisplayQty: () => 0, startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn() }));
vi.mock("../src/domain/inventoryActions", () => ({ recordInventoryAction: vi.fn() }));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn(), voidPurchaseOrder: vi.fn() }));
vi.mock("../src/domain/workflowActionError", () => ({ workflowActionErrorMessage: () => "" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, hasCapability: () => false, accessVersion: 1 }) }));
vi.mock("../src/modules/inventory/UsedInEquipmentSection", () => ({ default: () => null }));
vi.mock("../src/modules/inventory/PartWorkOrderDemandSection", () => ({ default: () => <div>Work order demand section</div> }));
vi.mock("../src/shared/partMaster/PartIdentifiersSection.jsx", () => ({ default: () => <div>Identifiers section</div> }));
vi.mock("../src/shared/partMaster/PartWriteModal.jsx", () => ({ default: () => null }));
vi.mock("../src/shared/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../src/shared/inventory/RequestReorderControl", () => ({ default: () => <div>Request reorder</div> }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("../src/shared/supplier/SupplierPicker", () => ({ default: () => null }));
vi.mock("../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => ({ loading: false, errorStatus: null, result: { manufacturers: [{ manufacturerId: "MFR-TAYLOR", name: "Taylor Company", status: "ACTIVE" }] } }),
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ partId: "TST-9001" }), useSearchParams: () => [new URLSearchParams(), () => {}], Link: ({ children }) => <a href="#x">{children}</a> };
});

import { fetchPartMasterList } from "../src/services/partMasterQueries";
import PartDetail from "../src/modules/inventory/PartDetail.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); ledger.transactions = []; ledger.healthEntries = []; });

// The document key and the Part Number are DIFFERENT strings, which is the only way a test can tell
// which one the page put in the title.
const DOC_ID = "TST-9001";
const PART_NUMBER = "C712-COMP";

function canonical(over = {}) {
  return {
    invalid: false,
    partId: DOC_ID,
    internalPartNumber: PART_NUMBER,
    name: "Compressor Assembly",
    description: "Compressor Assembly, Taylor C712",
    category: "Refrigeration",
    status: "ACTIVE",
    stockingUnit: "EACH",
    controlType: "SERIALIZED",
    stockingClass: "STOCKED",
    manufacturerId: "MFR-TAYLOR",
    manufacturerPartNumber: "047-712-88",
    oemStatus: "OEM",
    version: 1,
    ...over,
  };
}

async function renderRecord(over = {}) {
  fetchPartMasterList.mockResolvedValue({ ok: true, parts: [canonical(over)], invalid: [] });
  render(<PartDetail />);
  await screen.findByRole("heading", { level: 1 });
}

describe("ND-26 — the record is titled with the Part Number", () => {
  it("the h1 is internalPartNumber, and the document id is nowhere in the identity", async () => {
    await renderRecord();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(PART_NUMBER);
    const identity = document.querySelector(".ns-identity");
    expect(identity.textContent).not.toContain(DOC_ID);
  });

  it("the kicker reads Part and the two classification words, not raw enums", async () => {
    await renderRecord();
    const kicker = document.querySelector(".ns-identity__kicker");
    expect(kicker.textContent).toBe("Part · Serialized · Stocked");
    expect(kicker.textContent).not.toContain("SERIALIZED");
    expect(kicker.textContent).not.toContain("STOCKED");
  });

  it("a part carrying no Part Number says so rather than showing the key", async () => {
    await renderRecord({ internalPartNumber: null });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("No Part Number recorded");
    expect(document.querySelector(".ns-identity").textContent).not.toContain(DOC_ID);
  });
});

describe("ND-25 — the record states no quantity it does not have", () => {
  it("the identity layer carries no number at all", async () => {
    await renderRecord();
    const identity = document.querySelector(".ns-identity").textContent;
    // 38 is the static catalogue's warehouseQty. Its appearance anywhere in the header would mean
    // the baseline had been promoted into the record's identity as stock.
    expect(identity).not.toContain("38");
    expect(identity.toLowerCase()).not.toContain("on hand");
    expect(identity.toLowerCase()).not.toContain("available");
  });

  it("the static warehouse baseline is not rendered anywhere on the record", async () => {
    await renderRecord();
    expect(document.body.textContent).not.toContain("Warehouse baseline");
    expect(document.body.textContent).not.toContain("Reorder threshold (catalog)");
  });

  it("Where it is states why it cannot list locations, and draws no table", async () => {
    await renderRecord();
    const heading = screen.getByRole("heading", { name: "Where it is" });
    const section = heading.closest("section");
    expect(within(section).queryByRole("table")).toBeNull();
    expect(section.textContent).toContain("built and governed, and neither is switched on");
    // The distinction the section exists to preserve.
    expect(section.textContent).toContain("never implies custody or availability");
  });

  it("a part with no ledger activity gets the full record and a no-forecast sentence, not a no-stock claim", async () => {
    await renderRecord();
    // The record still renders whole — a part with no movements is a valid part, not a missing one.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(PART_NUMBER);
    const forecast = screen.getByRole("heading", { name: "Stock forecast" }).closest("section");
    expect(forecast.textContent).toContain("no stock forecast can be made");
    expect(forecast.textContent).toContain("not a statement about how many exist");
  });
});

describe("ND-27 — cost and price are refused", () => {
  it("no cost or price row appears on the record", async () => {
    await renderRecord();
    const body = document.body.textContent;
    expect(body).not.toContain("Cost");
    expect(body).not.toContain("Price");
    // The static catalogue's figures, which the design drew as "baseline" values.
    expect(body).not.toContain("2480");
    expect(body).not.toContain("$2,480.00");
  });

  it("purchasing context states the refusal and the inactive read as different things", async () => {
    await renderRecord();
    const section = screen.getByRole("heading", { name: "Purchasing context" }).closest("section");
    expect(section.textContent).toContain("Not available in this environment");
    expect(section.textContent).toContain("refused on this record");
    expect(section.textContent).toContain("display, reporting and export alike");
  });
});

describe("tracking mode decides the unit section — one treatment per Part", () => {
  it("a serial-tracked part gets Serialized units, and the assets-not-quantity sentence", async () => {
    await renderRecord({ controlType: "SERIALIZED" });
    const section = screen.getByRole("heading", { name: "Serialized units" }).closest("section");
    expect(section.textContent).toContain("never loose quantity");
    expect(within(section).queryByRole("table")).toBeNull();
  });

  it("a lot-tracked part gets Lots instead — not the serialized treatment", async () => {
    await renderRecord({ controlType: "LOT" });
    expect(screen.getByRole("heading", { name: "Lots" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Serialized units" })).toBeNull();
  });

  it("an untracked part gets NO unit section at all", async () => {
    await renderRecord({ controlType: "STANDARD" });
    expect(screen.queryByRole("heading", { name: "Serialized units" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Lots" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tracked units" })).toBeNull();
  });

  it("SERIALIZED_LOT fails closed — it is never collapsed into the serialized treatment", async () => {
    await renderRecord({ controlType: "SERIALIZED_LOT" });
    const section = screen.getByRole("heading", { name: "Tracked units" }).closest("section");
    expect(section.textContent).toContain("not supported");
    expect(screen.queryByRole("heading", { name: "Serialized units" })).toBeNull();
  });
});

describe("the composition rules", () => {
  it("the rail does not repeat a fact the header already stated", async () => {
    await renderRecord();
    const rail = document.querySelector(".ns-rail");
    const identity = document.querySelector(".ns-identity");
    // Stated once, in the header.
    expect(identity.textContent).toContain("Active");
    expect(identity.textContent).toContain("Taylor Company");
    expect(identity.textContent).toContain("Refrigeration");
    expect(identity.textContent).toContain("Each");
    expect(identity.textContent).toContain("OEM (Genuine)");
    // ...and not again in the rail's classification block.
    const classification = within(rail).queryByRole("heading", { name: "Classification" });
    if (classification) {
      const dl = classification.closest("section").querySelector(".ns-rail__dl");
      expect(dl.textContent).not.toContain("Active");
      expect(dl.textContent).not.toContain("Refrigeration");
      expect(dl.textContent).not.toContain("OEM (Genuine)");
    }
  });

  it("the manufacturer renders as its governed NAME, never as the raw id", async () => {
    await renderRecord();
    expect(document.body.textContent).toContain("Taylor Company");
    expect(document.body.textContent).not.toContain("MFR-TAYLOR");
  });

  it("activity renders movement WORDS, never the stored enum", async () => {
    ledger.transactions = [
      { id: "t1", partId: DOC_ID, workOrderId: "WO-1", type: "CONSUMED", quantity: 2, timestamp: 1_700_000_000_000 },
      { id: "t2", partId: DOC_ID, workOrderId: "WO-2", type: "TRANSFER_OUT", quantity: 1, timestamp: 1_699_000_000_000 },
    ];
    await renderRecord();
    const section = screen.getByRole("heading", { name: "Activity" }).closest("section");
    expect(section.textContent).toContain("Consumed");
    expect(section.textContent).toContain("Transfer out");
    expect(section.textContent).not.toContain("CONSUMED");
    expect(section.textContent).not.toContain("TRANSFER_OUT");
  });

  it("the activity heading claims only the ledger that exists", async () => {
    await renderRecord();
    const section = screen.getByRole("heading", { name: "Activity" }).closest("section");
    // The seven-type operational movement contract has no persistence, so the page must not name it
    // as though it could be read.
    expect(section.textContent).toContain("work-order and receiving ledger");
    expect(section.textContent).not.toContain("movement ledger");
  });

  it("the page makes no liveness claim, because the read is one-shot", async () => {
    await renderRecord();
    expect(document.querySelector(".ns-live")).toBeNull();
    expect(document.body.textContent).not.toContain("updates in real time");
  });
});

describe("four honest states, four different sentences", () => {
  const cases = [
    ["permission-denied", { ok: false, code: "permission-denied" }, /do not have access to the canonical Parts catalog/i],
    ["unavailable", { ok: false, code: "unavailable" }, /currently unavailable/i],
  ];
  for (const [name, read, sentence] of cases) {
    it(`a ${name} read blocks the record with its own sentence`, async () => {
      fetchPartMasterList.mockResolvedValue(read);
      render(<PartDetail />);
      await screen.findByText(sentence);
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    });
  }

  it("a readable catalogue with no such id is NOT FOUND — a different sentence from any block", async () => {
    fetchPartMasterList.mockResolvedValue({ ok: true, parts: [], invalid: [] });
    render(<PartDetail />);
    const msg = await screen.findByText(/No part is recorded under/i);
    expect(msg.textContent).toContain("The catalogue was read successfully");
    // Never conflated with a blocked read.
    expect(document.body.textContent).not.toMatch(/do not have access/i);
    expect(document.body.textContent).not.toMatch(/currently unavailable/i);
  });
});
