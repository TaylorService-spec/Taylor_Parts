// EI Mobile Inventory -- component tests for the ISOLATED, UNWIRED
// SerializedAssetsSection presentation slice (vitest + jsdom + RTL). The component has
// no Firebase/hooks/context, so nothing is mocked: it is rendered directly through its
// `section` prop with fixtures, exactly as it will be wired later.
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import SerializedAssetsSection, { __test__ } from "../src/modules/inventory/mobile/SerializedAssetsSection.jsx";

afterEach(cleanup);

// A fully-populated governed row (every merged-contract field present), used to prove the
// component renders only the display allowlist and never the withheld/absent fields.
const FULL_ROW = Object.freeze({
  assetId: "AST-001",
  internalSku: "SKU-777",
  manufacturer: "Acme",
  model: "PumpX",
  serial: "SN-ABC-123",
  // withheld / must-never-render values below:
  condition: "CONDITION-SHOULD-NOT-RENDER",
  status: "STATUS-SHOULD-NOT-RENDER",
  currentLocation: "MOBILE-LOC-LABEL",
  // fields absent from the merged contract -- must never render:
  quantity: 99,
  valuation: "$1234",
  custody: "CUSTODY-X",
  driver: "DRIVER-Y",
  gps: "12.34,-56.78",
  activeStatus: "ACTIVE-FLAG",
  rawSecret: "RAW-SOURCE-LEAK",
});

function readySection(items) {
  return { state: "ready", items };
}

describe("SerializedAssetsSection -- governed states", () => {
  it("renders the UNAVAILABLE state distinctly", () => {
    const { getByTestId, queryByTestId } = render(<SerializedAssetsSection section={{ state: "unavailable" }} />);
    expect(getByTestId("sa-unavailable")).toBeTruthy();
    expect(queryByTestId("sa-ready")).toBeNull();
  });

  it("renders the LOADING state distinctly with role=status", () => {
    const { getByTestId } = render(<SerializedAssetsSection section={{ state: "loading" }} />);
    const el = getByTestId("sa-loading");
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("status");
  });

  it("renders the DENIED state distinctly (no detail leak)", () => {
    const { getByTestId } = render(<SerializedAssetsSection section={{ state: "denied" }} />);
    expect(getByTestId("sa-denied")).toBeTruthy();
  });

  it("renders the ERROR state distinctly with role=alert and a sanitized message", () => {
    const { getByTestId } = render(<SerializedAssetsSection section={{ state: "error" }} />);
    const el = getByTestId("sa-error");
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toBe("Serialized assets could not be loaded.");
  });

  it("renders READY with items:[] as an honest empty state (not a table)", () => {
    const { getByTestId, queryByTestId, queryByRole } = render(<SerializedAssetsSection section={readySection([])} />);
    expect(getByTestId("sa-empty")).toBeTruthy();
    expect(queryByTestId("sa-ready")).toBeNull();
    expect(queryByRole("table")).toBeNull();
  });
});

describe("SerializedAssetsSection -- READY with projected rows", () => {
  it("renders one row per projected item using only the display allowlist columns", () => {
    const { getByRole, getByTestId } = render(
      <SerializedAssetsSection section={readySection([FULL_ROW, { assetId: "AST-002", serial: "SN-2" }])} />
    );
    const table = getByRole("table");
    expect(getByTestId("sa-ready")).toBeTruthy();
    // header labels = exactly the allowlist, in order
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Asset ID", "SKU", "Manufacturer", "Model", "Serial", "Location"]);
    // 2 data rows
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(2);
    // governed displayed values appear
    expect(within(table).getByText("AST-001")).toBeTruthy();
    expect(within(table).getByText("SN-ABC-123")).toBeTruthy();
    expect(within(table).getByText("MOBILE-LOC-LABEL")).toBeTruthy();
  });

  it("renders an em dash for a null governed value, never a fabricated one", () => {
    const { getByRole } = render(
      <SerializedAssetsSection section={readySection([{ assetId: "AST-9", internalSku: null, manufacturer: null, model: null, serial: null, currentLocation: null }])} />
    );
    const cells = within(getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    // assetId present, the rest are em dashes -- no zeros / blanks / fabricated values
    expect(cells).toEqual(["AST-9", "—", "—", "—", "—", "—"]);
  });
});

describe("SerializedAssetsSection -- no leakage of raw/withheld/unsupported fields", () => {
  it("never renders condition, status, or any field absent from the display allowlist", () => {
    const { container } = render(<SerializedAssetsSection section={readySection([FULL_ROW])} />);
    const html = container.innerHTML;
    for (const forbidden of [
      "CONDITION-SHOULD-NOT-RENDER",
      "STATUS-SHOULD-NOT-RENDER",
      "$1234",
      "CUSTODY-X",
      "DRIVER-Y",
      "12.34,-56.78",
      "ACTIVE-FLAG",
      "RAW-SOURCE-LEAK",
      "99",
    ]) {
      expect(html.includes(forbidden)).toBe(false);
    }
    // and no Condition/Status column headers exist
    expect(html.includes(">Condition<")).toBe(false);
    expect(html.includes(">Status<")).toBe(false);
  });

  it("display allowlist excludes condition and status by contract", () => {
    const keys = __test__.DISPLAY_COLUMNS.map((c) => c.key);
    expect(keys).not.toContain("condition");
    expect(keys).not.toContain("status");
  });
});

describe("SerializedAssetsSection -- fail closed on malformed/null input", () => {
  it("null -> unavailable", () => {
    const { getByTestId } = render(<SerializedAssetsSection section={null} />);
    expect(getByTestId("sa-unavailable")).toBeTruthy();
  });
  it("undefined (missing prop) -> unavailable", () => {
    const { getByTestId } = render(<SerializedAssetsSection />);
    expect(getByTestId("sa-unavailable")).toBeTruthy();
  });
  it.each([
    ["string", "garbage"],
    ["number", 42],
    ["array", []],
    ["unknown state", { state: "bogus" }],
    ["ready but items not an array", { state: "ready", items: "not-an-array" }],
    ["ready but items is an object", { state: "ready", items: {} }],
  ])("malformed input (%s) fails closed to a sanitized error", (_label, bad) => {
    const { getByTestId } = render(<SerializedAssetsSection section={bad} />);
    expect(getByTestId("sa-error")).toBeTruthy();
  });

  it("drops non-object and no-governed-value rows without throwing", () => {
    const { getByRole } = render(
      <SerializedAssetsSection section={readySection([null, 5, "x", {}, { unknownOnly: "z" }, { assetId: "KEEP" }])} />
    );
    const bodyRows = getByRole("table").querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(1); // only the { assetId: "KEEP" } row survives
    expect(within(getByRole("table")).getByText("KEEP")).toBeTruthy();
  });
});

describe("SerializedAssetsSection -- determinism & no input mutation", () => {
  it("renders identically across two renders (deterministic)", () => {
    const section = readySection([FULL_ROW, { assetId: "AST-002", serial: "SN-2" }]);
    const a = render(<SerializedAssetsSection section={section} />).container.innerHTML;
    cleanup();
    const b = render(<SerializedAssetsSection section={section} />).container.innerHTML;
    expect(a).toBe(b);
  });

  it("does not mutate the input section or its rows (deep-frozen input renders cleanly)", () => {
    const frozen = Object.freeze({ state: "ready", items: Object.freeze([Object.freeze({ ...FULL_ROW })]) });
    const before = JSON.stringify(frozen);
    expect(() => render(<SerializedAssetsSection section={frozen} />)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("SerializedAssetsSection -- accessibility & responsive semantics", () => {
  it("exposes a labelled region with a heading", () => {
    const { getByTestId, getByRole } = render(<SerializedAssetsSection section={{ state: "unavailable" }} />);
    const region = getByTestId("serialized-assets-section");
    expect(region.tagName.toLowerCase()).toBe("section");
    const heading = getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("Serialized Assets");
    // region is labelled by the heading id
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("uses column-scoped table headers in READY", () => {
    const { getByRole } = render(<SerializedAssetsSection section={readySection([FULL_ROW])} />);
    const ths = within(getByRole("table")).getAllByRole("columnheader");
    expect(ths.length).toBe(6);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });

  it("wraps the READY table in an overflow-x container so mobile has no page overflow", () => {
    const { getByTestId } = render(<SerializedAssetsSection section={readySection([FULL_ROW])} />);
    expect(getByTestId("sa-ready").style.overflowX).toBe("auto");
  });
});
