// WORKSTREAM 2B -- the reorder warehouse selector, and the gate it feeds.
//
// A Reorder Request now names a governed Warehouse, and the trusted createReorderRequest command
// derives the record's operatingCompanyId FROM that warehouse. So the warehouse is the one thing
// on this path that must be STATED. Owner ruling: "Client filtering is convenience. Server
// validation is authority" -- and the ruling's DO-NOT list is what most of this file pins:
//
//   no default selection · no free text · no inference from part, user, page or company ·
//   no reading a company out of a config at runtime · missing means the action is off
//
// These are UX behaviours, not the enforcement boundary. The callable refuses a request with no
// governed warehouse no matter what renders here. What this file protects is the weaker but very
// losable property: that the browser never QUIETLY supplies an answer nobody gave.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u1" }, role: "admin", operationalRoles: [] }),
}));

import ReorderWarehouseSelect from "../src/shared/inventory/ReorderWarehouseSelect.jsx";
import RequestReorderControl from "../src/shared/inventory/RequestReorderControl.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const OPTIONS = [
  { value: "wh-main", label: "Main Distribution Center" },
  { value: "wh-north", label: "North Service Depot" },
];
const READY = { recommendationStatus: "READY", urgency: "HIGH", recommendedOrderQty: 10 };
const NEEDS_PLANNING = { recommendationStatus: "NEEDS_PLANNING", urgency: null };

function selector(props = {}) {
  return render(
    <ReorderWarehouseSelect
      id="t"
      options={OPTIONS}
      loading={false}
      error={false}
      value=""
      onChange={() => {}}
      {...props}
    />
  );
}

describe("ReorderWarehouseSelect", () => {
  it("opens with NOTHING selected, even though a warehouse list is available", () => {
    // The empty value is a real state meaning "not stated yet". Preselecting the first option
    // would be the app answering a governed question on the user's behalf.
    selector();
    expect(screen.getByRole("combobox").value).toBe("");
    expect(screen.getByText("Select a warehouse...")).toBeTruthy();
  });

  it("does not preselect even when there is exactly one warehouse", () => {
    // The tempting special case. One option is still a choice nobody has made, and the request it
    // would author carries a company derived from it.
    selector({ options: [OPTIONS[0]] });
    expect(screen.getByRole("combobox").value).toBe("");
  });

  it("offers governed warehouse ids as the values, and no free-text entry", () => {
    // A warehouse that was never in the collection cannot be typed into a request.
    selector();
    const values = [...screen.getByRole("combobox").options].map((o) => o.value);
    expect(values).toEqual(["", "wh-main", "wh-north"]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("reports its own state honestly: loading, error and empty are not a silent list", () => {
    // Each of these previously would have been the moment to fall back to a default. None do.
    const { unmount } = selector({ loading: true });
    expect(screen.getByText(/Loading warehouses/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    unmount();

    const err = render(<ReorderWarehouseSelect id="t" options={[]} loading={false} error value="" onChange={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot be requested/);
    expect(screen.queryByRole("combobox")).toBeNull();
    err.unmount();

    selector({ options: [] });
    expect(screen.getByText(/No warehouses are available/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("reports the chosen id verbatim, and lets a choice be withdrawn", () => {
    const onChange = vi.fn();
    selector({ onChange });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "wh-north" } });
    expect(onChange).toHaveBeenCalledWith("wh-north");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("RequestReorderControl -- the warehouse gate", () => {
  it("READY: the one-click submit is OFF until a warehouse is chosen", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <RequestReorderControl recommendation={READY} onSubmit={onSubmit} submitting={false} alreadyRequested={false} warehouseId="" />
    );
    const button = screen.getByRole("button", { name: "Request Reorder" });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <RequestReorderControl recommendation={READY} onSubmit={onSubmit} submitting={false} alreadyRequested={false} warehouseId="wh-main" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Request Reorder" }));
    // Hands back the SAME value that unlocked it -- one warehouse, not two answers.
    expect(onSubmit).toHaveBeenCalledWith(undefined, "wh-main");
  });

  it("READY: an absent warehouseId prop is treated as absent, not as a reason to proceed", () => {
    // A caller that forgets to thread the prop must fail closed. The old signature had no such
    // prop at all, so "undefined" is exactly what a stale call site produces.
    const onSubmit = vi.fn();
    render(<RequestReorderControl recommendation={READY} onSubmit={onSubmit} submitting={false} alreadyRequested={false} />);
    expect(screen.getByRole("button", { name: "Request Reorder" }).disabled).toBe(true);
  });

  it("NEEDS_PLANNING: a valid quantity is not enough on its own", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <RequestReorderControl recommendation={NEEDS_PLANNING} onSubmit={onSubmit} submitting={false} alreadyRequested={false} warehouseId="" />
    );
    fireEvent.change(screen.getByLabelText("Manual reorder quantity"), { target: { value: "4" } });
    expect(screen.getByRole("button", { name: "Request Reorder" }).disabled).toBe(true);

    rerender(
      <RequestReorderControl recommendation={NEEDS_PLANNING} onSubmit={onSubmit} submitting={false} alreadyRequested={false} warehouseId="wh-north" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Request Reorder" }));
    expect(onSubmit).toHaveBeenCalledWith(4, "wh-north");
  });

  it("a chosen warehouse does not resurrect an already-requested row", () => {
    // Ordering guard: the warehouse gate is an ADDITIONAL condition, never a replacement for the
    // duplicate-request guard that was already there.
    render(
      <RequestReorderControl recommendation={READY} onSubmit={vi.fn()} submitting={false} alreadyRequested warehouseId="wh-main" />
    );
    expect(screen.getByText("Requested")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
