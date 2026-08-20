// OWNER PICKER — the control, and above all its DEGRADATION (vitest + jsdom).
//
// Opportunity.ownerEmployeeId is an Employee document id, and the employees collection is readable
// by admin/dispatcher only. So the interesting case is not the happy one: it is the salesperson
// who holds a real opportunity.write capability and CANNOT read the directory. If the picker did
// not degrade, that user would see an empty dropdown, conclude there are no employees, and be
// unable to keep the owner their Opportunity already has.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import OwnerSelect from "../src/modules/sales/OwnerSelect.jsx";

afterEach(cleanup);

const dir = (entries, over = {}) => ({
  byEmployeeId: new Map(entries),
  loading: false,
  error: null,
  ...over,
});

const READABLE = () =>
  dir([
    ["emp-2", { displayName: "Mikael Ruiz", securityRole: "salesperson" }],
    ["emp-1", { displayName: "Santana Cruz", securityRole: "salesManager" }],
  ]);

describe("OwnerSelect (directory readable)", () => {
  it("offers named employees rather than making the user type an opaque id", () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} directory={READABLE()} />);
    const select = screen.getByRole("combobox");
    expect(select.value).toBe("emp-1");
    expect(screen.getByRole("option", { name: /Santana Cruz/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Mikael Ruiz/ })).toBeTruthy();
  });

  it("sorts by label so the list is scannable, not insertion-ordered", () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} directory={READABLE()} />);
    const labels = [...screen.getAllByRole("option")].map((o) => o.textContent);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("reports the chosen employee id, not the display name", () => {
    const onChange = vi.fn();
    render(<OwnerSelect id="o" value="emp-1" onChange={onChange} directory={READABLE()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "emp-2" } });
    expect(onChange).toHaveBeenCalledWith("emp-2");
  });

  it("keeps an owner the directory does not list — a picker that cannot show its own value would force an unrelated change", () => {
    render(<OwnerSelect id="o" value="emp-gone" onChange={() => {}} directory={READABLE()} />);
    const select = screen.getByRole("combobox");
    expect(select.value).toBe("emp-gone");
    expect(screen.getByRole("option", { name: /not in directory/i })).toBeTruthy();
  });
});

describe("OwnerSelect (directory NOT readable — the salesperson case)", () => {
  it("falls back to an editable id field and says why, instead of showing an empty dropdown", () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} directory={dir([], { error: new Error("permission-denied") })} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    const box = screen.getByRole("textbox");
    expect(box.value).toBe("emp-1", "the current owner must survive an unreadable directory");
    expect(screen.getByText(/not authorized to browse the employee directory/i)).toBeTruthy();
  });

  it("the fallback is still SAVEABLE — losing the picker must not mean losing the ability to edit", () => {
    const onChange = vi.fn();
    render(<OwnerSelect id="o" value="emp-1" onChange={onChange} directory={dir([], { error: new Error("denied") })} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "emp-9" } });
    expect(onChange).toHaveBeenCalledWith("emp-9");
  });

  it("an EMPTY but readable directory is a different statement from a denied one", () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} directory={dir([])} />);
    expect(screen.getByText(/returned no records/i)).toBeTruthy();
    expect(screen.queryByText(/not authorized/i)).toBeNull();
  });

  it("while loading, the value is shown read-only rather than blanked", () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} directory={dir([], { loading: true })} />);
    expect(screen.getByRole("textbox").value).toBe("emp-1");
    expect(screen.getByText(/loading the employee directory/i)).toBeTruthy();
  });
});
