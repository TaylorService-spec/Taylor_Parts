// OWNER PICKER — the control, and above all its DEGRADATION (vitest + jsdom).
//
// Opportunity.ownerEmployeeId is a governed Employee id (the Commercial reads resolve it against eos_workforce.employees).
// UI corrections item E (2026-10-08): the picker is a TYPEAHEAD over the governed EOS roster (listWorkforceRoster), which
// replaces the Firestore employee directory. The interesting case is still the salesperson who holds a real
// opportunity.write capability and may NOT read the roster: they must keep -- and be able to save -- the owner the
// Opportunity already has.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import OwnerSelect from "../src/modules/sales/OwnerSelect.jsx";

afterEach(cleanup);

const ROSTER = [
  { employeeId: "emp-2", displayName: "Mikael Ruiz", employeeNumber: "S-2", jobRole: { label: "Retail Sales" } },
  { employeeId: "emp-1", displayName: "Santana Cruz", employeeNumber: "S-1", jobRole: { label: "National Accounts Sales" } },
];
const roster = (items = ROSTER) => ({
  call: vi.fn(async (operation, input) => {
    if (operation !== "listWorkforceRoster") return { ok: false, code: "UNKNOWN_OPERATION" };
    const q = String(input?.query ?? "").toLowerCase();
    const matches = items.filter((i) => !q || [i.displayName, i.employeeId, i.employeeNumber].some((v) => v.toLowerCase().includes(q)));
    return { ok: true, result: { items: matches.slice(0, input?.limit ?? 500), total: matches.length } };
  }),
});
const refused = (code) => ({ call: vi.fn(async () => ({ ok: false, code, message: "no" })) });

describe("OwnerSelect (roster readable)", () => {
  it("shows the current owner by NAME and offers named employees by typeahead rather than an opaque id", async () => {
    const workforce = roster();
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} workforce={workforce} />);
    const box = await screen.findByRole("combobox");
    await waitFor(() => expect(box.value).toBe("Santana Cruz"));
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "mik" } });
    expect(await screen.findByRole("option", { name: /Mikael Ruiz/ })).toBeTruthy();
    // EOS API + PostgreSQL only: the governed roster read, bounded.
    expect(workforce.call.mock.calls.every(([operation]) => operation === "listWorkforceRoster")).toBe(true);
  });

  it("reports the chosen employee id, not the display name", async () => {
    const onChange = vi.fn();
    render(<OwnerSelect id="o" value="emp-1" onChange={onChange} workforce={roster()} />);
    const box = await screen.findByRole("combobox");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Mik" } });
    fireEvent.pointerDown(await screen.findByRole("option", { name: /Mikael Ruiz/ }));
    expect(onChange).toHaveBeenCalledWith("emp-2");
  });

  it("keeps an owner the roster does not list — a picker that cannot show its own value would force an unrelated change", async () => {
    render(<OwnerSelect id="o" value="emp-gone" onChange={() => {}} workforce={roster()} />);
    const box = await screen.findByRole("combobox");
    await waitFor(() => expect(box.value).toMatch(/emp-gone \(not in directory\)/));
  });
});

describe("OwnerSelect (roster NOT readable — the salesperson case)", () => {
  it("falls back to an editable id field and says why, instead of showing an empty picker", async () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} workforce={refused("FORBIDDEN")} />);
    expect(await screen.findByText(/not authorized to browse the employee directory/i)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("textbox").value).toBe("emp-1");
  });

  it("the fallback is still SAVEABLE — losing the picker must not mean losing the ability to edit", async () => {
    const onChange = vi.fn();
    render(<OwnerSelect id="o" value="emp-1" onChange={onChange} workforce={refused("FORBIDDEN")} />);
    await screen.findByText(/not authorized/i);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "emp-9" } });
    expect(onChange).toHaveBeenCalledWith("emp-9");
  });

  it("an EMPTY but readable roster is a different statement from a denied one", async () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} workforce={roster([])} />);
    expect(await screen.findByText(/returned no records/i)).toBeTruthy();
    expect(screen.queryByText(/not authorized/i)).toBeNull();
  });

  it("while loading, the value is shown read-only rather than blanked", () => {
    render(<OwnerSelect id="o" value="emp-1" onChange={() => {}} workforce={{ call: vi.fn(() => new Promise(() => {})) }} />);
    expect(screen.getByRole("textbox").value).toBe("emp-1");
    expect(screen.getByText(/loading the employee directory/i)).toBeTruthy();
  });
});
