// The Transfer form offers WAREHOUSE endpoints only (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01):
// truck transfers belong to the separate Truck Inventory journey, so no Truck choice -- and no truck list -- exists.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TransferOrderForm from "../src/modules/inventory/TransferOrderForm.jsx";

afterEach(cleanup);

describe("TransferOrderForm — warehouse endpoints only", () => {
  it("neither end offers a Truck, and the warehouse options are the governed ones passed in", () => {
    render(<TransferOrderForm warehouseOptions={[{ id: "taylor-main", label: "Taylor Main Warehouse" }]} submitting={false} onSubmit={async () => ({ ok: true })} onCancel={() => {}} />);
    for (const label of ["Origin type", "Destination type"]) {
      expect([...screen.getByLabelText(label).querySelectorAll("option")].map((o) => o.value)).toEqual(["WAREHOUSE"]);
    }
    expect(screen.getAllByRole("option", { name: "Taylor Main Warehouse" }).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/truck/i);
  });
});
