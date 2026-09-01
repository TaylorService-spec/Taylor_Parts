// Workstream 2B / R-17 — the selector reads ONE trusted source, and has no way back to the other one.
//
// The ruling: "Do not retain a hidden generic LIST attempt followed by callable fallback. That would
// leave two read-authority models for the same selector." A fallback is the tempting shape here —
// the generic hook already exists and works for an admin — and it would hide the very failure this
// change was made to fix, for exactly the personas it was made to fix it for.
//
// So most of this file asserts ABSENCES, which is the only way to test that a door was not left ajar.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const invoke = vi.fn();
vi.mock("../src/firebase/firebase.js", () => ({ db: {}, auth: {}, functions: {} }));

import { fetchReorderWarehouseOptions, REORDER_CALLABLES } from "../src/services/reorderCallableClient.js";
import { useReorderWarehouseOptions } from "../src/hooks/useReorderWarehouseOptions.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const SRC = join(process.cwd(), "src");
const code = (path) =>
  readFileSync(join(SRC, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("fetchReorderWarehouseOptions — the transport", () => {
  it("calls the trusted projection, with no arguments of its own to get wrong", async () => {
    invoke.mockResolvedValue({ options: [{ warehouseId: "wh-main", label: "Main" }], reason: "UNSCOPED_SECURITY_ROLE" });
    const result = await fetchReorderWarehouseOptions(invoke);
    expect(invoke).toHaveBeenCalledWith(REORDER_CALLABLES.listReorderWarehouseOptions, {});
    // The server decides scope from the authenticated principal. A client-supplied filter would be
    // a second opinion about who the caller is.
    expect(result.options).toEqual([{ value: "wh-main", label: "Main" }]);
    expect(result.reason).toBe("UNSCOPED_SECURITY_ROLE");
  });

  it("survives a malformed or empty response without inventing an option", async () => {
    for (const data of [{}, null, { options: null }, { options: "nope" }]) {
      invoke.mockResolvedValue(data);
      const result = await fetchReorderWarehouseOptions(invoke);
      expect(result.options).toEqual([]);
      expect(result.reason).toBe(null);
    }
  });

  it("drops an option with no id, and falls back to the id when the label is missing", async () => {
    invoke.mockResolvedValue({
      options: [{ warehouseId: "wh-a", label: "" }, { warehouseId: "", label: "Ghost" }, { label: "No id at all" }],
      reason: null,
    });
    const { options } = await fetchReorderWarehouseOptions(invoke);
    expect(options).toEqual([{ value: "wh-a", label: "wh-a" }]);
  });
});

function Probe({ load }) {
  const state = useReorderWarehouseOptions(true, { load });
  return (
    <div>
      <span data-testid="state">{state.loading ? "loading" : state.error ? "error" : "ready"}</span>
      <span data-testid="count">{state.options.length}</span>
      <span data-testid="reason">{state.reason ?? "none"}</span>
    </div>
  );
}

describe("useReorderWarehouseOptions", () => {
  it("renders the trusted options once they arrive", async () => {
    const load = vi.fn().mockResolvedValue({ options: [{ value: "wh-main", label: "Main" }], reason: "UNSCOPED_SECURITY_ROLE" });
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("ready"));
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("a failed read is an ERROR, never an empty list", async () => {
    // The distinction is the whole point. An empty list says "no warehouse is governed to you"; a
    // failure says "we do not know". Collapsing the second into the first is how a broken read gets
    // read as a settled fact.
    render(<Probe load={vi.fn().mockRejectedValue(new Error("permission-denied"))} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("error"));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("an empty list with a reason is a real answer, and the reason survives", async () => {
    const load = vi.fn().mockResolvedValue({ options: [], reason: "PARTS_MANAGER_SCOPE_UNDEFINED" });
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("ready"));
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("reason").textContent).toBe("PARTS_MANAGER_SCOPE_UNDEFINED");
  });
});

describe("ONE selector, ONE read authority", () => {
  const SURFACES = [
    "modules/inventory/PartsList.jsx",
    "modules/inventory/PartDetail.jsx",
    "modules/inventoryRole/WarehouseManagerHome.jsx",
  ];

  it("no reorder surface reaches for the generic collection-LIST hook", () => {
    // useWarehouseOptions is a getDocs of the `warehouses` collection. It stays for Truck
    // Management (admin-only, readiness-gated); it must not come back here.
    for (const path of SURFACES) {
      expect(code(path)).not.toMatch(/useWarehouseOptions/);
      expect(code(path)).toMatch(/useReorderWarehouseOptions/);
    }
  });

  it("the trusted hook contains no Firestore fallback of any kind", () => {
    const src = code("hooks/useReorderWarehouseOptions.js");
    expect(src).not.toMatch(/getDocs|collection\(|firebase\/firestore/);
    // Specifically: no catch that reaches for the other source.
    expect(src).not.toMatch(/catch[\s\S]{0,200}(getDocs|useWarehouseOptions|fetchWarehouseOptions)/);
  });

  it("the selector itself still reads nothing — it renders what it is handed", () => {
    const src = code("shared/inventory/ReorderWarehouseSelect.jsx");
    expect(src).not.toMatch(/getDocs|httpsCallable|fetchReorderWarehouseOptions|useReorderWarehouseOptions/);
  });

  it("the transport still never sends a company, on the new path either", () => {
    expect(code("services/reorderCallableClient.js")).not.toMatch(/operatingCompanyId\s*:/);
  });

  it("no warehouse id or company is hard-coded on any reorder surface", () => {
    for (const path of [...SURFACES, "hooks/useReorderWarehouseOptions.js", "services/reorderCallableClient.js"]) {
      expect(code(path)).not.toMatch(/["'`]wh-/);
      expect(code(path)).not.toMatch(/["'](taylor|ventana)["']/i);
    }
  });
});
