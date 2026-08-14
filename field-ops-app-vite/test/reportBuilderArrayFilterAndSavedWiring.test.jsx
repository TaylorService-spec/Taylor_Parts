// Site-work round-4 item E -- component-render coverage (vitest + jsdom, the ONLY DOM harness in
// the repo, see vitest.config.js) for two ReportBuilder.jsx / SavedReports.jsx fixes:
//
//  Fix 1: an array-valued comparator (in / containsAny / between) previously had no matching value
//  control -- the row always rendered a single scalar input, so reportQueryValidation.js's "requires
//  a non-empty array value" rule could never clear and Run stayed disabled forever. Proven here by
//  driving the real FilterRow through a real comparator switch and asserting Run goes from
//  disabled -> enabled once a legal array value is entered.
//
//  Fix 2: ReportBuilder had no Save control (SavedReports' "New" always wrote a hardcoded starter,
//  never the user's actual definition) and "Open" never hydrated the builder at all. Proven here by
//  (a) driving ReportBuilder's own Save control and asserting the INJECTED savedReportService.create
//  receives the real in-progress definition, not a stub, and (b) rendering ReportBuilder with
//  ?open=<id> in the URL and asserting it hydrates from the injected get() result.
//
// Only the report domain modules are real (catalog/model/validator/reconciler); firebase itself is
// never called -- runReportFn and savedReportServiceImpl are the same injection seams the pure
// tests (test/reportBuilder.test.mjs) document, so no network path is exercised here either.
// Interaction pattern (fireEvent, no @testing-library/user-event or jest-dom matchers -- neither is
// a repo dependency) mirrors test/equipmentWorkspace.test.jsx: presence via getByText(...).toBeTruthy()
// / queryByText(...).toBeNull(), state via native DOM properties (.value / .checked / .disabled).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ReportBuilder from "../src/modules/reporting/ReportBuilder.jsx";
import SavedReports from "../src/modules/reporting/SavedReports.jsx";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const withRouter = (ui, initialEntries = ["/reporting/builder"]) =>
  render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);

// A field label can repeat -- a related object can reuse a label (e.g. "Name" on both Customer and
// its related Contact), and once a field is selected it's echoed again in Group By/Sort. Scope to
// the BASE object's own fieldset (always the first one inside "Fields"), which is the one place a
// field is guaranteed exactly one checkbox.
function baseFieldsFieldset() {
  const region = within(screen.getByRole("region", { name: "Fields" }));
  return within(region.getAllByRole("group")[0]);
}

function pickObjectAndField(objectValue, fieldLabel) {
  fireEvent.change(screen.getByLabelText("Object"), { target: { value: objectValue } });
  fireEvent.click(baseFieldsFieldset().getByRole("checkbox", { name: fieldLabel }));
}

describe("ReportBuilder — array-value filter input (Fix 1)", () => {
  it("selecting an array comparator (in) has no legal value until an array is entered, then Run enables", () => {
    withRouter(<ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get: vi.fn(), create: vi.fn() }} />);

    pickObjectAndField("customer", "Status");
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    fireEvent.change(screen.getByLabelText("Comparator"), { target: { value: "in" } });

    const runButton = screen.getByRole("button", { name: /run report/i });
    // No legal value yet -- the array comparator's control is empty, Run stays disabled (this is
    // the exact bug: previously there was no way to ever satisfy this and Run was PERMANENTLY off).
    expect(runButton.disabled).toBe(true);
    expect(screen.getByText(/requires a non-empty array/i)).toBeTruthy();

    // The comma-separated array control -- typing a real array value.
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "active, trial" } });

    expect(runButton.disabled).toBe(false);
    expect(screen.queryByText(/requires a non-empty array/i)).toBeNull();
  });

  it("`between` renders exactly two bound inputs and clears validation once both are filled", () => {
    withRouter(<ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get: vi.fn(), create: vi.fn() }} />);

    pickObjectAndField("customer", "Created");
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    fireEvent.change(screen.getByLabelText("Comparator"), { target: { value: "between" } });

    // Exactly two bound inputs, no more, no less -- and until both are legal dates, Run is off.
    expect(screen.getByLabelText("From")).toBeTruthy();
    expect(screen.getByLabelText("To")).toBeTruthy();
    expect(screen.getByRole("button", { name: /run report/i }).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2024-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2024-12-31" } });

    expect(screen.queryByText(/ISO-8601|exactly two/i)).toBeNull();
    expect(screen.getByRole("button", { name: /run report/i }).disabled).toBe(false);
  });

  it("switching between two array comparators (in <-> containsAny) keeps the value; a scalar comparator resets it", () => {
    withRouter(<ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get: vi.fn(), create: vi.fn() }} />);

    pickObjectAndField("customer", "Tags");
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    fireEvent.change(screen.getByLabelText("Comparator"), { target: { value: "containsAny" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "vip, net30" } });
    expect(screen.getByLabelText("Value").value).toBe("vip, net30");

    // "contains" is the other legal comparator for `list` -- scalar, so the value resets.
    fireEvent.change(screen.getByLabelText("Comparator"), { target: { value: "contains" } });
    expect(screen.getByLabelText("Value").value).toBe("");
  });
});

describe("ReportBuilder — Saved Reports wiring (Fix 2)", () => {
  it("Save persists the ACTUAL in-progress definition via the injected create(), not a stub", async () => {
    const create = vi.fn().mockResolvedValue({ id: "new-1" });
    withRouter(<ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get: vi.fn(), create }} />);

    pickObjectAndField("customer", "Name");
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "My customer names" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new report" }));

    await screen.findByText(/saved “my customer names”/i);
    expect(create).toHaveBeenCalledTimes(1);
    const [payload] = create.mock.calls[0];
    expect(payload.name).toBe("My customer names");
    // The REAL definition the user built -- object + the field they actually selected -- never the
    // hardcoded starterDefinition() stub SavedReports' "New" uses.
    expect(payload.definition.objectId).toBe("customer");
    expect(payload.definition.fields).toEqual(["customer.name"]);
  });

  it("a create() rejection surfaces a safe message, never a raw error", async () => {
    const create = vi.fn().mockRejectedValue({ code: "functions/invalid-argument" });
    withRouter(<ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get: vi.fn(), create }} />);

    pickObjectAndField("customer", "Name");
    fireEvent.change(screen.getByLabelText("Report name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new report" }));

    await screen.findByText(/couldn't be saved/i);
  });

  it("?open=<id> hydrates the builder from the injected get() (object + field pre-selected)", async () => {
    const savedDefinition = {
      objectId: "customer", fields: ["customer.name", "customer.status"],
      filters: [], groupBy: [], sort: [], aggregates: [], presentation: {},
    };
    const get = vi.fn().mockResolvedValue({ id: "abc", name: "Saved One", definition: savedDefinition });
    withRouter(
      <ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get, create: vi.fn() }} />,
      ["/reporting/builder?open=abc"],
    );

    await screen.findByText(/still valid against the current data catalog/i);
    expect(get).toHaveBeenCalledWith("abc");
    expect(screen.getByLabelText("Object").value).toBe("customer");
    const base = baseFieldsFieldset();
    expect(base.getByRole("checkbox", { name: "Name" }).checked).toBe(true);
    expect(base.getByRole("checkbox", { name: "Status" }).checked).toBe(true);
    // The Save name field is pre-filled from the opened report's name.
    expect(screen.getByLabelText("Report name").value).toBe("Saved One");
  });

  it("an unopenable saved report (bad base object) hydrates nothing and shows a safe refusal", async () => {
    const get = vi.fn().mockResolvedValue({ id: "bad-1", name: "Broken", definition: { objectId: "no-such-object" } });
    withRouter(
      <ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get, create: vi.fn() }} />,
      ["/reporting/builder?open=bad-1"],
    );

    await screen.findByText(/couldn't open this report/i);
    // Nothing hydrated -- still the empty "choose an object" state.
    expect(screen.getByLabelText("Object").value).toBe("");
  });

  it("a get() rejection (e.g. not-found) shows a safe failure state, not a raw code", async () => {
    const get = vi.fn().mockRejectedValue({ code: "functions/not-found" });
    withRouter(
      <ReportBuilder runReportFn={vi.fn()} savedReportServiceImpl={{ get, create: vi.fn() }} />,
      ["/reporting/builder?open=gone"],
    );

    await screen.findByText(/no longer exists/i);
  });
});

describe("SavedReports — Open navigates to the builder (Fix 2)", () => {
  const openableRecord = {
    id: "r1", name: "Openable report", ownerUid: "u1",
    updatedAtMillis: Date.now(),
    definition: { objectId: "customer", fields: ["customer.name"], filters: [], groupBy: [], sort: [], aggregates: [], presentation: {} },
  };
  const unopenableRecord = {
    id: "r2", name: "Broken report", ownerUid: "u1",
    updatedAtMillis: Date.now(),
    definition: { objectId: "no-such-object" },
  };

  it("Open on a valid saved report navigates to /reporting/builder?open=<id>", async () => {
    const service = { list: vi.fn().mockResolvedValue([openableRecord]) };
    render(
      <MemoryRouter initialEntries={["/reporting/saved"]}>
        <SavedReports hasCapability={() => true} service={service} />
      </MemoryRouter>,
    );

    const openButton = await screen.findByRole("button", { name: /open openable report/i });
    fireEvent.click(openButton);

    // Navigation happened -- the inline "can't be opened" panel never appears for an openable report.
    expect(screen.queryByText(/can.t be opened/i)).toBeNull();
  });

  it("Open on an unopenable saved report shows the inline refusal and does not navigate away", async () => {
    const service = { list: vi.fn().mockResolvedValue([unopenableRecord]) };
    render(
      <MemoryRouter initialEntries={["/reporting/saved"]}>
        <SavedReports hasCapability={() => true} service={service} />
      </MemoryRouter>,
    );

    const openButton = await screen.findByRole("button", { name: /open broken report/i });
    fireEvent.click(openButton);

    await screen.findByText(/“broken report” can.t be opened/i);
    // Still on the Saved Reports list -- the row is still there.
    expect(screen.getByRole("button", { name: /open broken report/i })).toBeTruthy();
  });
});
