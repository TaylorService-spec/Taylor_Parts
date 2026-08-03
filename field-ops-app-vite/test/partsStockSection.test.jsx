// EI Mobile Inventory -- component tests for the ISOLATED, UNWIRED PartsStockSection
// presentation slice (vitest + jsdom + RTL). The component has no Firebase/hooks/context,
// so nothing is mocked: it is rendered directly through its `section` prop with fixtures.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import PartsStockSection, { __test__ } from "../src/modules/inventory/mobile/PartsStockSection.jsx";

afterEach(cleanup);

// A fully-populated governed row plus extra/unsupported fields that must never render.
const FULL_ROW = Object.freeze({
  internalSku: "P-001",
  description: "Widget",
  bin: "A1",
  onHand: 5,
  reserved: 2,
  available: 3,
  reorderStatus: "OK",
  // unsupported / must-never-render:
  valuation: "VALUATION-Z",
  driver: "DRIVER-Z",
  gps: "GPS-Z",
  custody: "CUSTODY-Z",
  locationId: "LOCID-Z",
  rawSecret: "RAW-Z",
  quantity: 7,
});

const COLUMN_LABELS = ["SKU", "Description", "Bin", "On Hand", "Reserved", "Available", "Reorder Status"];

function readySection(items) {
  return { state: "ready", items };
}

describe("PartsStockSection -- governed states", () => {
  it("renders UNAVAILABLE distinctly", () => {
    const { getByTestId, queryByTestId } = render(<PartsStockSection section={{ state: "unavailable" }} />);
    expect(getByTestId("ps-unavailable")).toBeTruthy();
    expect(queryByTestId("ps-ready")).toBeNull();
  });
  it("renders LOADING distinctly with role=status", () => {
    const { getByTestId } = render(<PartsStockSection section={{ state: "loading" }} />);
    expect(getByTestId("ps-loading").getAttribute("role")).toBe("status");
  });
  it("renders DENIED distinctly (no detail leak)", () => {
    const { getByTestId } = render(<PartsStockSection section={{ state: "denied" }} />);
    expect(getByTestId("ps-denied")).toBeTruthy();
  });
  it("renders ERROR distinctly with role=alert and a sanitized message", () => {
    const { getByTestId } = render(<PartsStockSection section={{ state: "error" }} />);
    const el = getByTestId("ps-error");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toBe("Parts stock could not be loaded.");
  });
  it("renders READY items:[] as the honest empty state (not a table)", () => {
    const { getByTestId, queryByRole } = render(<PartsStockSection section={readySection([])} />);
    expect(getByTestId("ps-empty")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
  });
});

describe("PartsStockSection -- READY rows", () => {
  it("renders one row per item using only the allowlist columns, quantities passed through", () => {
    const { getByRole } = render(<PartsStockSection section={readySection([FULL_ROW])} />);
    const table = getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(COLUMN_LABELS);
    const cells = within(table).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["P-001", "Widget", "A1", "5", "2", "3", "OK"]);
  });

  it("renders a real governed 0 as '0' (a distinct value, not hidden)", () => {
    const { getByRole } = render(<PartsStockSection section={readySection([{ internalSku: "Z", onHand: 0, reserved: 0, available: 0 }])} />);
    const cells = within(getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["Z", "—", "—", "0", "0", "0", "—"]);
  });

  it("a missing numeric field renders an em dash, never zero", () => {
    const { getByRole } = render(<PartsStockSection section={readySection([{ internalSku: "M", onHand: null, reserved: null, available: null }])} />);
    const cells = within(getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["M", "—", "—", "—", "—", "—", "—"]);
    expect(cells).not.toContain("0");
  });

  it("never computes available = onHand - reserved (absent available stays em dash)", () => {
    const { getByRole } = render(<PartsStockSection section={readySection([{ internalSku: "C", onHand: 5, reserved: 2 }])} />);
    const cells = within(getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    // onHand 5, reserved 2, available ABSENT -> "—", never a computed "3"
    expect(cells).toEqual(["C", "—", "—", "5", "2", "—", "—"]);
  });
});

describe("PartsStockSection -- no leakage of raw/unsupported fields", () => {
  it("never renders valuation/driver/gps/custody/locationId/raw/quantity or their headers", () => {
    const { container } = render(<PartsStockSection section={readySection([FULL_ROW])} />);
    const html = container.innerHTML;
    for (const forbidden of ["VALUATION-Z", "DRIVER-Z", "GPS-Z", "CUSTODY-Z", "LOCID-Z", "RAW-Z"]) {
      expect(html.includes(forbidden)).toBe(false);
    }
    expect(html.includes(">7<")).toBe(false); // quantity:7 never rendered
    for (const label of ["Valuation", "Driver", "GPS", "Custody"]) expect(html.includes(">" + label + "<")).toBe(false);
  });

  it("display allowlist is exactly the merged parts contract fields", () => {
    expect(__test__.DISPLAY_COLUMNS.map((c) => c.key)).toEqual([
      "internalSku", "description", "bin", "onHand", "reserved", "available", "reorderStatus",
    ]);
  });
});

describe("PartsStockSection -- fail closed on malformed section input", () => {
  it("null -> unavailable", () => {
    expect(render(<PartsStockSection section={null} />).getByTestId("ps-unavailable")).toBeTruthy();
  });
  it("undefined (missing prop) -> unavailable", () => {
    expect(render(<PartsStockSection />).getByTestId("ps-unavailable")).toBeTruthy();
  });
  it.each([
    ["string", "garbage"],
    ["number", 42],
    ["array", []],
    ["unknown state", { state: "bogus" }],
    ["ready but items not an array", { state: "ready", items: "x" }],
    ["ready but items is an object", { state: "ready", items: {} }],
  ])("malformed section (%s) fails closed to a sanitized error", (_l, bad) => {
    expect(render(<PartsStockSection section={bad} />).getByTestId("ps-error")).toBeTruthy();
  });
});

// Whole-payload fail-closed: any malformed row fails the entire section; only items:[] is empty.
describe("PartsStockSection -- READY payload integrity", () => {
  it("READY + [null] -> ERROR, not empty", () => {
    const { getByTestId, queryByTestId } = render(<PartsStockSection section={readySection([null])} />);
    expect(getByTestId("ps-error")).toBeTruthy();
    expect(queryByTestId("ps-empty")).toBeNull();
  });
  it("READY + [{}] -> ERROR", () => {
    expect(render(<PartsStockSection section={readySection([{}])} />).getByTestId("ps-error")).toBeTruthy();
  });
  it("READY + [validRow, malformedRow] -> ERROR, no partial table", () => {
    const { getByTestId, queryByRole, queryByText } = render(
      <PartsStockSection section={readySection([{ internalSku: "VALID" }, {}])} />
    );
    expect(getByTestId("ps-error")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
    expect(queryByText("VALID")).toBeNull();
  });
  it("READY + row with a wrong-typed numeric field (onHand as string) -> ERROR", () => {
    expect(render(<PartsStockSection section={readySection([{ internalSku: "P", onHand: "5" }])} />).getByTestId("ps-error")).toBeTruthy();
  });
  it("READY + row with a wrong-typed string field (internalSku as number) -> ERROR", () => {
    expect(render(<PartsStockSection section={readySection([{ internalSku: 5, onHand: 1 }])} />).getByTestId("ps-error")).toBeTruthy();
  });
  it("READY + row with no displayable governed value -> ERROR", () => {
    expect(render(<PartsStockSection section={readySection([{ unknownOnly: "z" }])} />).getByTestId("ps-error")).toBeTruthy();
  });
  it("READY + [] remains the sole honest empty result", () => {
    expect(render(<PartsStockSection section={readySection([])} />).getByTestId("ps-empty")).toBeTruthy();
  });
  it("READY + all valid rows renders the table (no false error)", () => {
    const { getByRole } = render(<PartsStockSection section={readySection([{ internalSku: "A" }, { internalSku: "B", onHand: 0 }])} />);
    expect(getByRole("table").querySelectorAll("tbody tr").length).toBe(2);
  });
});

// internalSku is the mandatory governed identity -- no other field may substitute for it.
describe("PartsStockSection -- mandatory internalSku identity", () => {
  it.each([
    ["{ onHand: 5 }", { onHand: 5 }],
    ["{ description: 'Widget' }", { description: "Widget" }],
    ["{ internalSku: null, available: 3 }", { internalSku: null, available: 3 }],
    ["{ internalSku: '   ', available: 3 }", { internalSku: "   ", available: 3 }],
  ])("READY + [%s] -> ERROR (missing/blank SKU, no substitute)", (_l, row) => {
    const { getByTestId, queryByRole } = render(<PartsStockSection section={readySection([row])} />);
    expect(getByTestId("ps-error")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
  });

  it("READY + [valid SKU row, missing-SKU row] -> whole-section ERROR, no partial table", () => {
    const { getByTestId, queryByRole, queryByText } = render(
      <PartsStockSection section={readySection([{ internalSku: "HAS-SKU" }, { onHand: 9 }])} />
    );
    expect(getByTestId("ps-error")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
    expect(queryByText("HAS-SKU")).toBeNull();
  });

  it("READY + [nonblank SKU with nullable optional fields] -> READY", () => {
    const { getByRole } = render(
      <PartsStockSection section={readySection([{ internalSku: "SKU-ONLY", description: null, bin: null, onHand: null, reserved: null, available: null, reorderStatus: null }])} />
    );
    const cells = within(getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["SKU-ONLY", "—", "—", "—", "—", "—", "—"]);
  });
});

describe("PartsStockSection -- determinism & no input mutation", () => {
  it("renders identical content across two renders (per-instance useId normalized)", () => {
    const normalize = (html) => html.replace(/id="[^"]*"/g, 'id="X"').replace(/aria-labelledby="[^"]*"/g, 'aria-labelledby="X"');
    const section = readySection([FULL_ROW, { internalSku: "P-002" }]);
    const a = render(<PartsStockSection section={section} />).container.innerHTML;
    cleanup();
    const b = render(<PartsStockSection section={section} />).container.innerHTML;
    expect(normalize(a)).toBe(normalize(b));
  });
  it("does not mutate the deep-frozen input", () => {
    const frozen = Object.freeze({ state: "ready", items: Object.freeze([Object.freeze({ ...FULL_ROW })]) });
    const before = JSON.stringify(frozen);
    expect(() => render(<PartsStockSection section={frozen} />)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("PartsStockSection -- unique render identities", () => {
  it("two instances have distinct heading ids, each labelling itself", () => {
    const { container } = render(
      <div>
        <PartsStockSection section={{ state: "unavailable" }} />
        <PartsStockSection section={{ state: "loading" }} />
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
  it("duplicate internalSku rows render deterministically with no duplicate-key warning or lost rows", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByRole } = render(<PartsStockSection section={readySection([{ internalSku: "DUP" }, { internalSku: "DUP" }])} />);
    expect(getByRole("table").querySelectorAll("tbody tr").length).toBe(2);
    const keyWarning = spy.mock.calls.some((c) => c.some((a) => typeof a === "string" && a.includes("same key")));
    expect(keyWarning).toBe(false);
    spy.mockRestore();
  });
});

describe("PartsStockSection -- accessibility & responsive semantics", () => {
  it("exposes a labelled region with a heading", () => {
    const { getByTestId, getByRole } = render(<PartsStockSection section={{ state: "unavailable" }} />);
    const region = getByTestId("parts-stock-section");
    expect(region.tagName.toLowerCase()).toBe("section");
    const heading = getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("Parts Stock");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
  });
  it("uses column-scoped table headers in READY", () => {
    const { getByRole } = render(<PartsStockSection section={readySection([FULL_ROW])} />);
    const ths = within(getByRole("table")).getAllByRole("columnheader");
    expect(ths.length).toBe(7);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });
  it("wraps the READY table in an overflow-x container (no mobile page overflow)", () => {
    const { getByTestId } = render(<PartsStockSection section={readySection([FULL_ROW])} />);
    expect(getByTestId("ps-ready").style.overflowX).toBe("auto");
  });
});
