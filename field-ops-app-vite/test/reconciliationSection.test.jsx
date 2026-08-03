// EI Mobile Inventory -- component tests for the ISOLATED, UNWIRED ReconciliationSection
// presentation slice (vitest + jsdom + RTL). The component has no Firebase/hooks/context,
// so nothing is mocked: it is rendered directly through its `section` prop with fixtures.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import ReconciliationSection, { __test__ } from "../src/modules/inventory/mobile/ReconciliationSection.jsx";

afterEach(cleanup);

// A fully-populated missing/unexpected item plus extra/unsupported fields that must never render.
const FULL_ITEM = Object.freeze({
  assetId: "AST-1",
  internalSku: "SKU-1",
  label: "Pump",
  serial: "SN-1",
  lastSeen: "2026-08-01",
  expected: "1",
  actual: "0",
  note: "not found",
  // unsupported / must-never-render:
  locationId: "LOCID-Z",
  truck: "TRUCK-Z",
  employee: "EMP-Z",
  customer: "CUST-Z",
  gps: "GPS-Z",
  valuation: "VAL-Z",
  rawSecret: "RAW-Z",
});

const OBS_VALID = Object.freeze({
  expectedSerialized: 8,
  scannedSerialized: 3,
  expectedParts: 20,
  scannedParts: 10,
  missing: [FULL_ITEM],
  unexpected: [{ assetId: "AST-2", serial: "SN-2" }],
});

function readyObs(observation) {
  return { state: "ready", observation };
}

describe("ReconciliationSection -- governed states", () => {
  it("renders UNAVAILABLE distinctly", () => {
    const { getByTestId, queryByTestId } = render(<ReconciliationSection section={{ state: "unavailable" }} />);
    expect(getByTestId("rc-unavailable")).toBeTruthy();
    expect(queryByTestId("rc-ready")).toBeNull();
  });
  it("renders LOADING distinctly with role=status", () => {
    expect(render(<ReconciliationSection section={{ state: "loading" }} />).getByTestId("rc-loading").getAttribute("role")).toBe("status");
  });
  it("renders DENIED distinctly (no detail leak)", () => {
    expect(render(<ReconciliationSection section={{ state: "denied" }} />).getByTestId("rc-denied")).toBeTruthy();
  });
  it("renders ERROR distinctly with role=alert and a sanitized message", () => {
    const el = render(<ReconciliationSection section={{ state: "error" }} />).getByTestId("rc-error");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toBe("Reconciliation could not be loaded.");
  });
  it("non-READY states never inspect observation contents (loading with junk observation still loads)", () => {
    const { getByTestId, queryByTestId } = render(<ReconciliationSection section={{ state: "loading", observation: { garbage: true } }} />);
    expect(getByTestId("rc-loading")).toBeTruthy();
    expect(queryByTestId("rc-ready")).toBeNull();
    expect(queryByTestId("rc-error")).toBeNull();
  });
});

describe("ReconciliationSection -- READY complete observation", () => {
  it("renders the summary counts and both item tables from the allowlist only", () => {
    const { getByTestId } = render(<ReconciliationSection section={readyObs(OBS_VALID)} />);
    const dds = [...getByTestId("rc-summary").querySelectorAll("dd")].map((d) => d.textContent);
    expect(dds).toEqual(["8", "3", "20", "10"]);
    const missing = getByTestId("rc-missing-table");
    expect(within(missing).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Asset ID", "SKU", "Label", "Serial", "Last seen", "Expected", "Actual", "Note"]);
    expect(within(missing).getAllByRole("cell").map((td) => td.textContent)).toEqual(["AST-1", "SKU-1", "Pump", "SN-1", "2026-08-01", "1", "0", "not found"]);
    // unexpected sparse row
    expect(within(getByTestId("rc-unexpected-table")).getAllByRole("cell").map((td) => td.textContent)).toEqual(["AST-2", "—", "—", "SN-2", "—", "—", "—", "—"]);
  });

  it("renders a real governed 0 count as '0' and a null count as an em dash", () => {
    const { getByTestId } = render(<ReconciliationSection section={readyObs({ expectedSerialized: 0, scannedSerialized: null, expectedParts: 7, scannedParts: 0, missing: [], unexpected: [] })} />);
    const dds = [...getByTestId("rc-summary").querySelectorAll("dd")].map((d) => d.textContent);
    expect(dds).toEqual(["0", "—", "7", "0"]);
  });

  it("empty missing/unexpected arrays render honest 'none reported' (not a completed cycle count)", () => {
    const { getByTestId, queryByTestId } = render(<ReconciliationSection section={readyObs({ expectedSerialized: null, scannedSerialized: null, expectedParts: null, scannedParts: null, missing: [], unexpected: [] })} />);
    expect(getByTestId("rc-missing-empty").textContent).toBe("No missing items reported.");
    expect(getByTestId("rc-unexpected-empty").textContent).toBe("No unexpected items reported.");
    expect(queryByTestId("rc-missing-table")).toBeNull();
    // null counts render em dashes -- a pass-through observation, no fabricated totals
    expect([...getByTestId("rc-summary").querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["—", "—", "—", "—"]);
  });

  it("renders a sparse valid item (one governed value) with em dashes elsewhere", () => {
    const cells = within(render(<ReconciliationSection section={readyObs({ missing: [{ note: "seen once" }], unexpected: [] })} />).getByTestId("rc-missing-table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["—", "—", "—", "—", "—", "—", "—", "seen once"]);
  });
});

describe("ReconciliationSection -- no leakage & no computed logic", () => {
  it("never renders unsupported item fields or their headers", () => {
    const html = render(<ReconciliationSection section={readyObs(OBS_VALID)} />).container.innerHTML;
    for (const forbidden of ["LOCID-Z", "TRUCK-Z", "EMP-Z", "CUST-Z", "GPS-Z", "VAL-Z", "RAW-Z"]) {
      expect(html.includes(forbidden)).toBe(false);
    }
  });

  it("never computes variance/discrepancy/total/completion/recommendation", () => {
    const { container, getByTestId } = render(<ReconciliationSection section={readyObs(OBS_VALID)} />);
    for (const word of ["Variance", "Discrepancy", "Total", "Complete", "Completed", "Recommend"]) {
      expect(container.innerHTML.includes(word)).toBe(false);
    }
    // exactly the four governed counts -- no computed fifth value
    expect(getByTestId("rc-summary").querySelectorAll("dd").length).toBe(4);
  });

  it("ignores unknown top-level observation keys (never rendered, still valid)", () => {
    const { getByTestId, container } = render(<ReconciliationSection section={readyObs({ ...OBS_VALID, secretTotal: "SECRET-Z" })} />);
    expect(getByTestId("rc-ready")).toBeTruthy();
    expect(container.innerHTML.includes("SECRET-Z")).toBe(false);
  });

  it("allowlists match the merged contract exactly", () => {
    expect(__test__.COUNT_FIELDS.map((c) => c.key)).toEqual(["expectedSerialized", "scannedSerialized", "expectedParts", "scannedParts"]);
    expect(__test__.ITEM_COLUMNS.map((c) => c.key)).toEqual(["assetId", "internalSku", "label", "serial", "lastSeen", "expected", "actual", "note"]);
  });
});

describe("ReconciliationSection -- fail closed on malformed section input", () => {
  it("null -> unavailable", () => {
    expect(render(<ReconciliationSection section={null} />).getByTestId("rc-unavailable")).toBeTruthy();
  });
  it("undefined (missing prop) -> unavailable", () => {
    expect(render(<ReconciliationSection />).getByTestId("rc-unavailable")).toBeTruthy();
  });
  it.each([
    ["string", "garbage"],
    ["number", 42],
    ["array", []],
    ["unknown state", { state: "bogus" }],
    ["ready but observation null", { state: "ready", observation: null }],
    ["ready but observation missing", { state: "ready" }],
    ["ready but observation not an object", { state: "ready", observation: "x" }],
  ])("malformed section (%s) fails closed to a sanitized error", (_l, bad) => {
    expect(render(<ReconciliationSection section={bad} />).getByTestId("rc-error")).toBeTruthy();
  });
});

// Whole-section fail-closed on a malformed observation payload.
describe("ReconciliationSection -- READY observation integrity", () => {
  const base = { expectedSerialized: 1, scannedSerialized: 1, expectedParts: 1, scannedParts: 1, missing: [], unexpected: [] };
  it.each([
    ["count wrong type (string)", { ...base, expectedSerialized: "5" }],
    ["count not finite (Infinity)", { ...base, scannedParts: Infinity }],
    ["count NaN", { ...base, expectedParts: NaN }],
    ["missing not an array", { ...base, missing: "x" }],
    ["unexpected not an array", { ...base, unexpected: {} }],
    ["missing absent", { expectedSerialized: 1, scannedSerialized: 1, expectedParts: 1, scannedParts: 1, unexpected: [] }],
    ["item not a plain object", { ...base, missing: [null] }],
    ["item field wrong type (assetId number)", { ...base, missing: [{ assetId: 5 }] }],
    ["item all-null recognized fields", { ...base, missing: [{ assetId: null, serial: null }] }],
    ["item only unknown fields (no displayable)", { ...base, unexpected: [{ foo: "x" }] }],
  ])("READY + observation with %s -> whole-section ERROR", (_l, observation) => {
    const { getByTestId, queryByTestId } = render(<ReconciliationSection section={readyObs(observation)} />);
    expect(getByTestId("rc-error")).toBeTruthy();
    expect(queryByTestId("rc-ready")).toBeNull();
  });

  it("mixed valid + malformed item -> whole-section ERROR, no partial content", () => {
    const { getByTestId, queryByTestId, queryByText } = render(<ReconciliationSection section={readyObs({ ...base, missing: [{ assetId: "OK" }, {}] })} />);
    expect(getByTestId("rc-error")).toBeTruthy();
    expect(queryByTestId("rc-missing-table")).toBeNull();
    expect(queryByText("OK")).toBeNull();
  });
});

describe("ReconciliationSection -- determinism & no input mutation", () => {
  it("renders identical content across two renders (per-instance useId normalized)", () => {
    const normalize = (html) => html.replace(/id="[^"]*"/g, 'id="X"').replace(/aria-labelledby="[^"]*"/g, 'aria-labelledby="X"');
    const section = readyObs(OBS_VALID);
    const a = render(<ReconciliationSection section={section} />).container.innerHTML;
    cleanup();
    const b = render(<ReconciliationSection section={section} />).container.innerHTML;
    expect(normalize(a)).toBe(normalize(b));
  });
  it("does not mutate the deep-frozen input", () => {
    const frozen = Object.freeze({ state: "ready", observation: Object.freeze({ ...OBS_VALID, missing: Object.freeze([Object.freeze({ ...FULL_ITEM })]), unexpected: Object.freeze([]) }) });
    const before = JSON.stringify(frozen);
    expect(() => render(<ReconciliationSection section={frozen} />)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("ReconciliationSection -- unique render identities", () => {
  it("two instances have distinct heading ids, each labelling itself", () => {
    const { container } = render(
      <div>
        <ReconciliationSection section={{ state: "unavailable" }} />
        <ReconciliationSection section={{ state: "loading" }} />
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
  it("duplicate item identifiers retain every row with no duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const table = render(<ReconciliationSection section={readyObs({ missing: [{ assetId: "DUP", serial: "S" }, { assetId: "DUP", serial: "S" }, { assetId: "DUP", serial: "S" }], unexpected: [] })} />).getByTestId("rc-missing-table");
    expect(table.querySelectorAll("tbody tr").length).toBe(3);
    const keyWarning = spy.mock.calls.some((c) => c.some((a) => typeof a === "string" && a.includes("same key")));
    expect(keyWarning).toBe(false);
    spy.mockRestore();
  });
});

describe("ReconciliationSection -- accessibility & responsive semantics", () => {
  it("exposes a labelled region with a heading", () => {
    const { getByTestId, getByRole } = render(<ReconciliationSection section={{ state: "unavailable" }} />);
    const region = getByTestId("reconciliation-section");
    expect(region.tagName.toLowerCase()).toBe("section");
    const heading = getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("Reconciliation");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
  });
  it("gives each item table a caption and column-scoped headers", () => {
    const { getByTestId } = render(<ReconciliationSection section={readyObs(OBS_VALID)} />);
    for (const variant of ["missing", "unexpected"]) {
      const table = within(getByTestId(`rc-${variant}-table`)).getByRole("table");
      expect(table.querySelector("caption")).toBeTruthy();
      const ths = within(table).getAllByRole("columnheader");
      expect(ths.length).toBe(8);
      for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
    }
  });
  it("wraps each item table in an overflow-x container (no mobile page overflow)", () => {
    const { getByTestId } = render(<ReconciliationSection section={readyObs(OBS_VALID)} />);
    expect(getByTestId("rc-missing-table").style.overflowX).toBe("auto");
    expect(getByTestId("rc-unexpected-table").style.overflowX).toBe("auto");
  });
});
