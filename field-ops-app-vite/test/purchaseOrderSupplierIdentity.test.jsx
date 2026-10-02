// DECISIONS #193 (Owner 2026-10-02) -- a NEW Purchase Order names a governed supplier IDENTITY, picked BY NAME. The employee
// never types a supplier and never sees an id; the client sends { kind, id } and the server authors the display name.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const sent = [];
vi.mock("../src/services/reorderApiClient.js", () => ({
  reorderApiClient: { call: vi.fn(async (operation, input) => { sent.push({ operation, input }); return { ok: true }; }) },
}));

const { recordPurchaseOrder } = await import("../src/domain/reorderPurchaseOrders.js");
const { supplierIdentityFromOption } = await import("../src/domain/supplierPicker.js");

const valid = { externalPoNumber: "PO-1", orderedQuantity: "2", orderedDate: "2026-10-02", unitPriceMajor: "41.00", currency: "USD" };
const acme = { id: "EXTERNAL_ORGANIZATION:SUP-ACME", name: "Acme Refrigeration", status: "ACTIVE" };
const ventana = { id: "INTERNAL_OPERATING_COMPANY:ventana", name: "Ventana", status: "ACTIVE" };

describe("governed supplier identity on a new Purchase Order", () => {
  beforeEach(() => { sent.length = 0; });

  it("an external supplier picked by name is sent as its governed identity -- never its name", async () => {
    await recordPurchaseOrder("rr-1", { ...valid, supplier: acme });
    expect(sent).toHaveLength(1);
    expect(sent[0].operation).toBe("recordReorderPurchaseOrder");
    expect(sent[0].input.supplier).toEqual({ kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" });
    expect("supplierName" in sent[0].input).toBe(false);
  });

  it("an internal operating company picked by name is sent as that company's identity", async () => {
    await recordPurchaseOrder("rr-2", { ...valid, supplier: ventana });
    expect(sent[0].input.supplier).toEqual({ kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: "ventana" });
  });

  it("supplier TEXT alone cannot create a new Purchase Order -- nothing is sent", async () => {
    // recordPurchaseOrder validates synchronously, before any call is made.
    expect(() => recordPurchaseOrder("rr-3", { ...valid, supplierName: "Acme Refrigeration" })).toThrow(/Select a supplier/);
    expect(() => recordPurchaseOrder("rr-3", { ...valid, supplier: "Acme Refrigeration" })).toThrow(/Select a supplier/);
    expect(sent).toHaveLength(0);
  });

  it("only a governed option resolves to an identity; a renamed display label cannot change it", () => {
    expect(supplierIdentityFromOption({ ...acme, name: "Some Other Vendor" })).toEqual({ kind: "EXTERNAL_ORGANIZATION", supplierId: "SUP-ACME" });
    for (const bad of [null, { ...acme, status: "INACTIVE" }, { id: "SUP-ACME", name: "x", status: "ACTIVE" },
      { id: "CONSOLIDATED:consolidated", name: "Consolidated", status: "ACTIVE" }, { id: "EXTERNAL_ORGANIZATION:", name: "x", status: "ACTIVE" }]) {
      expect(supplierIdentityFromOption(bad)).toBeNull();
    }
  });

  it("no Purchase Order screen passes a typed supplier name to the write", () => {
    const root = join(process.cwd(), "src");
    const files = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(js|jsx)$/.test(n)) files.push(f); } };
    walk(root);
    const CALL = "await recordPurchaseOrder(";
    const callers = files.filter((f) => readFileSync(f, "utf8").includes(CALL));
    expect(callers.length).toBe(2); // PartDetail (Record Purchase Order) and the Parts Associate request panel
    for (const f of callers) {
      const src = readFileSync(f, "utf8");
      const call = src.slice(src.indexOf(CALL), src.indexOf(CALL) + 400);
      expect(call).toMatch(/supplier: selectedSupplier/);
      expect(call).not.toMatch(/supplierName/);
    }
  });
});
