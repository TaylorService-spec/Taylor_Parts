// EI Mobile Inventory -- component tests for the ISOLATED, UNWIRED ReservationsSection
// presentation slice (vitest + jsdom + RTL). The component has no Firebase/hooks/context,
// so nothing is mocked: it is rendered directly through its `section` prop with fixtures.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import ReservationsSection, { __test__ } from "../src/modules/inventory/mobile/ReservationsSection.jsx";

afterEach(cleanup);

// A fully-populated governed row plus extra/unsupported fields that must never render.
const FULL_ROW = Object.freeze({
  order: "ORD-1",
  kind: "HARD",
  internalSku: "SKU-1",
  serial: "SN-1",
  quantity: 4,
  state: "ACTIVE",
  // unsupported / must-never-render (customer/employee/custody/direction/truck/location/valuation):
  customer: "CUSTOMER-Z",
  employee: "EMPLOYEE-Z",
  custody: "CUSTODY-Z",
  direction: "DIRECTION-Z",
  truck: "TRUCK-Z",
  locationId: "LOCID-Z",
  valuation: "VALUATION-Z",
  rawSecret: "RAW-Z",
});

const COLUMN_LABELS = ["Order", "Kind", "SKU", "Serial", "Quantity", "State"];

function readySection(items) {
  return { state: "ready", items };
}

describe("ReservationsSection -- governed states", () => {
  it("renders UNAVAILABLE distinctly", () => {
    const { getByTestId, queryByTestId } = render(<ReservationsSection section={{ state: "unavailable" }} />);
    expect(getByTestId("rs-unavailable")).toBeTruthy();
    expect(queryByTestId("rs-ready")).toBeNull();
  });
  it("renders LOADING distinctly with role=status", () => {
    expect(render(<ReservationsSection section={{ state: "loading" }} />).getByTestId("rs-loading").getAttribute("role")).toBe("status");
  });
  it("renders DENIED distinctly (no detail leak)", () => {
    expect(render(<ReservationsSection section={{ state: "denied" }} />).getByTestId("rs-denied")).toBeTruthy();
  });
  it("renders ERROR distinctly with role=alert and a sanitized message", () => {
    const el = render(<ReservationsSection section={{ state: "error" }} />).getByTestId("rs-error");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toBe("Reservations could not be loaded.");
  });
  it("renders READY items:[] as the honest empty state (not a table)", () => {
    const { getByTestId, queryByRole } = render(<ReservationsSection section={readySection([])} />);
    expect(getByTestId("rs-empty")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
  });
});

describe("ReservationsSection -- READY rows", () => {
  it("renders one row per item using only the allowlist columns, quantity passed through", () => {
    const table = render(<ReservationsSection section={readySection([FULL_ROW])} />).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(COLUMN_LABELS);
    expect(within(table).getAllByRole("cell").map((td) => td.textContent)).toEqual(["ORD-1", "HARD", "SKU-1", "SN-1", "4", "ACTIVE"]);
  });

  it("renders a sparse valid row (one governed value) with em dashes elsewhere", () => {
    const cells = within(render(<ReservationsSection section={readySection([{ kind: "SOFT" }])} />).getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["—", "SOFT", "—", "—", "—", "—"]);
  });

  it("renders a real governed 0 quantity as '0' (visible, not hidden)", () => {
    const cells = within(render(<ReservationsSection section={readySection([{ order: "Z", quantity: 0 }])} />).getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["Z", "—", "—", "—", "0", "—"]);
  });

  it("renders a missing quantity as an em dash, never zero", () => {
    const cells = within(render(<ReservationsSection section={readySection([{ order: "M", quantity: null }])} />).getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["M", "—", "—", "—", "—", "—"]);
    expect(cells).not.toContain("0");
  });

  it("does no derived math -- quantities render as separate pass-through cells, never a sum/total", () => {
    const { container } = render(<ReservationsSection section={readySection([{ order: "A", quantity: 5 }, { order: "B", quantity: 3 }])} />);
    const html = container.innerHTML;
    expect(html.includes(">5<")).toBe(true);
    expect(html.includes(">3<")).toBe(true);
    expect(html.includes(">8<")).toBe(false); // no summed total
  });
});

describe("ReservationsSection -- no leakage of raw/unsupported fields", () => {
  it("never renders customer/employee/custody/direction/truck/location/valuation/raw or their headers", () => {
    const html = render(<ReservationsSection section={readySection([FULL_ROW])} />).container.innerHTML;
    for (const forbidden of ["CUSTOMER-Z", "EMPLOYEE-Z", "CUSTODY-Z", "DIRECTION-Z", "TRUCK-Z", "LOCID-Z", "VALUATION-Z", "RAW-Z"]) {
      expect(html.includes(forbidden)).toBe(false);
    }
    for (const label of ["Customer", "Employee", "Custody", "Direction", "Truck", "Location", "Valuation"]) {
      expect(html.includes(">" + label + "<")).toBe(false);
    }
  });

  it("display allowlist is exactly the merged reservations contract fields", () => {
    expect(__test__.DISPLAY_COLUMNS.map((c) => c.key)).toEqual(["order", "kind", "internalSku", "serial", "quantity", "state"]);
  });
});

describe("ReservationsSection -- fail closed on malformed section input", () => {
  it("null -> unavailable", () => {
    expect(render(<ReservationsSection section={null} />).getByTestId("rs-unavailable")).toBeTruthy();
  });
  it("undefined (missing prop) -> unavailable", () => {
    expect(render(<ReservationsSection />).getByTestId("rs-unavailable")).toBeTruthy();
  });
  it.each([
    ["string", "garbage"],
    ["number", 42],
    ["array", []],
    ["unknown state", { state: "bogus" }],
    ["ready but items not an array", { state: "ready", items: "x" }],
    ["ready but items is an object", { state: "ready", items: {} }],
  ])("malformed section (%s) fails closed to a sanitized error", (_l, bad) => {
    expect(render(<ReservationsSection section={bad} />).getByTestId("rs-error")).toBeTruthy();
  });
});

// Whole-payload fail-closed: any malformed row fails the entire section; only items:[] is empty.
describe("ReservationsSection -- READY payload integrity", () => {
  it("READY + [null] -> ERROR, not empty", () => {
    const { getByTestId, queryByTestId } = render(<ReservationsSection section={readySection([null])} />);
    expect(getByTestId("rs-error")).toBeTruthy();
    expect(queryByTestId("rs-empty")).toBeNull();
  });
  it("READY + [{}] (no displayable value) -> ERROR", () => {
    expect(render(<ReservationsSection section={readySection([{}])} />).getByTestId("rs-error")).toBeTruthy();
  });
  it("READY + [row with only unknown fields] -> ERROR", () => {
    expect(render(<ReservationsSection section={readySection([{ customer: "x" }])} />).getByTestId("rs-error")).toBeTruthy();
  });
  it("READY + row with wrong-typed quantity (string) -> ERROR", () => {
    expect(render(<ReservationsSection section={readySection([{ order: "O", quantity: "5" }])} />).getByTestId("rs-error")).toBeTruthy();
  });
  it("READY + row with wrong-typed string field (order as number) -> ERROR", () => {
    expect(render(<ReservationsSection section={readySection([{ order: 5, kind: "HARD" }])} />).getByTestId("rs-error")).toBeTruthy();
  });
  it("READY + [validRow, malformedRow] -> ERROR, no partial table", () => {
    const { getByTestId, queryByRole, queryByText } = render(<ReservationsSection section={readySection([{ order: "VALID" }, {}])} />);
    expect(getByTestId("rs-error")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
    expect(queryByText("VALID")).toBeNull();
  });
  it("READY + [] remains the sole honest empty result", () => {
    expect(render(<ReservationsSection section={readySection([])} />).getByTestId("rs-empty")).toBeTruthy();
  });
  it("READY + all valid rows renders the table (no false error)", () => {
    const table = render(<ReservationsSection section={readySection([{ order: "A" }, { serial: "S", quantity: 0 }])} />).getByRole("table");
    expect(table.querySelectorAll("tbody tr").length).toBe(2);
  });
});

describe("ReservationsSection -- determinism & no input mutation", () => {
  it("renders identical content across two renders (per-instance useId normalized)", () => {
    const normalize = (html) => html.replace(/id="[^"]*"/g, 'id="X"').replace(/aria-labelledby="[^"]*"/g, 'aria-labelledby="X"');
    const section = readySection([FULL_ROW, { order: "ORD-2" }]);
    const a = render(<ReservationsSection section={section} />).container.innerHTML;
    cleanup();
    const b = render(<ReservationsSection section={section} />).container.innerHTML;
    expect(normalize(a)).toBe(normalize(b));
  });
  it("does not mutate the deep-frozen input", () => {
    const frozen = Object.freeze({ state: "ready", items: Object.freeze([Object.freeze({ ...FULL_ROW })]) });
    const before = JSON.stringify(frozen);
    expect(() => render(<ReservationsSection section={frozen} />)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("ReservationsSection -- unique render identities", () => {
  it("two instances have distinct heading ids, each labelling itself", () => {
    const { container } = render(
      <div>
        <ReservationsSection section={{ state: "unavailable" }} />
        <ReservationsSection section={{ state: "loading" }} />
      </div>
    );
    const sections = container.querySelectorAll("section");
    const h0 = sections[0].querySelector("h3");
    const h1 = sections[1].querySelector("h3");
    expect(h0.id).toBeTruthy();
    expect(h0.id).not.toBe(h1.id);
    expect(sections[0].getAttribute("aria-labelledby")).toBe(h0.id);
    expect(sections[1].getAttribute("aria-labelledby")).toBe(h1.id);
  });
  it("repeated order/SKU/serial identifiers retain every row with no duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const table = render(
      <ReservationsSection section={readySection([
        { order: "DUP", internalSku: "S", serial: "N" },
        { order: "DUP", internalSku: "S", serial: "N" },
        { order: "DUP", internalSku: "S", serial: "N" },
      ])} />
    ).getByRole("table");
    expect(table.querySelectorAll("tbody tr").length).toBe(3);
    const keyWarning = spy.mock.calls.some((c) => c.some((a) => typeof a === "string" && a.includes("same key")));
    expect(keyWarning).toBe(false);
    spy.mockRestore();
  });
});

describe("ReservationsSection -- accessibility & responsive semantics", () => {
  it("exposes a labelled region with a heading and a caption", () => {
    const { getByTestId, getByRole } = render(<ReservationsSection section={readySection([FULL_ROW])} />);
    const region = getByTestId("reservations-section");
    expect(region.tagName.toLowerCase()).toBe("section");
    const heading = getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("Reservations");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(getByRole("table").querySelector("caption").textContent).toBe("Reservations at this location");
  });
  it("uses column-scoped table headers in READY", () => {
    const ths = within(render(<ReservationsSection section={readySection([FULL_ROW])} />).getByRole("table")).getAllByRole("columnheader");
    expect(ths.length).toBe(6);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });
  it("wraps the READY table in an overflow-x container (no mobile page overflow)", () => {
    expect(render(<ReservationsSection section={readySection([FULL_ROW])} />).getByTestId("rs-ready").style.overflowX).toBe("auto");
  });
});
