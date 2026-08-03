// EI Mobile Inventory -- component tests for the ISOLATED, UNWIRED ActivitySection
// presentation slice (vitest + jsdom + RTL). The component has no Firebase/hooks/context,
// so nothing is mocked: it is rendered directly through its `section` prop with fixtures.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import ActivitySection, { __test__ } from "../src/modules/inventory/mobile/ActivitySection.jsx";

afterEach(cleanup);

// A fully-populated governed row plus extra/unsupported fields that must never render.
const FULL_ROW = Object.freeze({
  time: "2026-08-03T10:00:00Z",
  type: "TRANSFER",
  message: "Truck loaded",
  // unsupported / must-never-render:
  locationId: "LOCID-Z",
  truck: "TRUCK-Z",
  actor: "ACTOR-Z",
  quantity: 9,
  rawSecret: "RAW-Z",
});

const COLUMN_LABELS = ["Time", "Type", "Message"];

function readySection(items) {
  return { state: "ready", items };
}

describe("ActivitySection -- governed states", () => {
  it("renders UNAVAILABLE distinctly", () => {
    const { getByTestId, queryByTestId } = render(<ActivitySection section={{ state: "unavailable" }} />);
    expect(getByTestId("as-unavailable")).toBeTruthy();
    expect(queryByTestId("as-ready")).toBeNull();
  });
  it("renders LOADING distinctly with role=status", () => {
    expect(render(<ActivitySection section={{ state: "loading" }} />).getByTestId("as-loading").getAttribute("role")).toBe("status");
  });
  it("renders DENIED distinctly (no detail leak)", () => {
    expect(render(<ActivitySection section={{ state: "denied" }} />).getByTestId("as-denied")).toBeTruthy();
  });
  it("renders ERROR distinctly with role=alert and a sanitized message", () => {
    const el = render(<ActivitySection section={{ state: "error" }} />).getByTestId("as-error");
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toBe("Activity could not be loaded.");
  });
  it("renders READY items:[] as the honest empty state (not a table)", () => {
    const { getByTestId, queryByRole } = render(<ActivitySection section={readySection([])} />);
    expect(getByTestId("as-empty")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
  });
});

describe("ActivitySection -- READY rows", () => {
  it("renders one row per item using only the allowlist columns", () => {
    const table = render(<ActivitySection section={readySection([FULL_ROW])} />).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(COLUMN_LABELS);
    expect(within(table).getAllByRole("cell").map((td) => td.textContent)).toEqual(["2026-08-03T10:00:00Z", "TRANSFER", "Truck loaded"]);
  });

  it("renders a sparse valid row (one governed value) with em dashes elsewhere", () => {
    const cells = within(render(<ActivitySection section={readySection([{ message: "Note only" }])} />).getByRole("table")).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["—", "—", "Note only"]);
  });
});

describe("ActivitySection -- no leakage of raw/unsupported fields", () => {
  it("never renders location/truck/actor/quantity/raw or their headers", () => {
    const html = render(<ActivitySection section={readySection([FULL_ROW])} />).container.innerHTML;
    for (const forbidden of ["LOCID-Z", "TRUCK-Z", "ACTOR-Z", "RAW-Z"]) {
      expect(html.includes(forbidden)).toBe(false);
    }
    expect(html.includes(">9<")).toBe(false); // quantity never rendered
    for (const label of ["Location", "Truck", "Actor", "Quantity"]) expect(html.includes(">" + label + "<")).toBe(false);
  });

  it("display allowlist is exactly the merged activity contract fields", () => {
    expect(__test__.DISPLAY_COLUMNS.map((c) => c.key)).toEqual(["time", "type", "message"]);
  });
});

describe("ActivitySection -- fail closed on malformed section input", () => {
  it("null -> unavailable", () => {
    expect(render(<ActivitySection section={null} />).getByTestId("as-unavailable")).toBeTruthy();
  });
  it("undefined (missing prop) -> unavailable", () => {
    expect(render(<ActivitySection />).getByTestId("as-unavailable")).toBeTruthy();
  });
  it.each([
    ["string", "garbage"],
    ["number", 42],
    ["array", []],
    ["unknown state", { state: "bogus" }],
    ["ready but items not an array", { state: "ready", items: "x" }],
    ["ready but items is an object", { state: "ready", items: {} }],
  ])("malformed section (%s) fails closed to a sanitized error", (_l, bad) => {
    expect(render(<ActivitySection section={bad} />).getByTestId("as-error")).toBeTruthy();
  });
});

// Whole-payload fail-closed: any malformed row fails the entire section; only items:[] is empty.
describe("ActivitySection -- READY payload integrity", () => {
  it("READY + [null] -> ERROR, not empty", () => {
    const { getByTestId, queryByTestId } = render(<ActivitySection section={readySection([null])} />);
    expect(getByTestId("as-error")).toBeTruthy();
    expect(queryByTestId("as-empty")).toBeNull();
  });
  it("READY + [{}] (no displayable value) -> ERROR", () => {
    expect(render(<ActivitySection section={readySection([{}])} />).getByTestId("as-error")).toBeTruthy();
  });
  it("READY + [row with only unknown fields] -> ERROR", () => {
    expect(render(<ActivitySection section={readySection([{ actor: "x" }])} />).getByTestId("as-error")).toBeTruthy();
  });
  it("READY + row with a wrong-typed field (type as number) -> ERROR", () => {
    expect(render(<ActivitySection section={readySection([{ type: 5, message: "m" }])} />).getByTestId("as-error")).toBeTruthy();
  });
  it("READY + [validRow, malformedRow] -> ERROR, no partial table", () => {
    const { getByTestId, queryByRole, queryByText } = render(<ActivitySection section={readySection([{ message: "VALID" }, {}])} />);
    expect(getByTestId("as-error")).toBeTruthy();
    expect(queryByRole("table")).toBeNull();
    expect(queryByText("VALID")).toBeNull();
  });
  it("READY + [] remains the sole honest empty result", () => {
    expect(render(<ActivitySection section={readySection([])} />).getByTestId("as-empty")).toBeTruthy();
  });
  it("READY + all valid rows renders the table (no false error)", () => {
    const table = render(<ActivitySection section={readySection([{ time: "t1" }, { message: "m2" }])} />).getByRole("table");
    expect(table.querySelectorAll("tbody tr").length).toBe(2);
  });
});

describe("ActivitySection -- determinism & no input mutation", () => {
  it("renders identical content across two renders (per-instance useId normalized)", () => {
    const normalize = (html) => html.replace(/id="[^"]*"/g, 'id="X"').replace(/aria-labelledby="[^"]*"/g, 'aria-labelledby="X"');
    const section = readySection([FULL_ROW, { time: "t2" }]);
    const a = render(<ActivitySection section={section} />).container.innerHTML;
    cleanup();
    const b = render(<ActivitySection section={section} />).container.innerHTML;
    expect(normalize(a)).toBe(normalize(b));
  });
  it("does not mutate the deep-frozen input", () => {
    const frozen = Object.freeze({ state: "ready", items: Object.freeze([Object.freeze({ ...FULL_ROW })]) });
    const before = JSON.stringify(frozen);
    expect(() => render(<ActivitySection section={frozen} />)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe("ActivitySection -- unique render identities", () => {
  it("two instances have distinct heading ids, each labelling itself", () => {
    const { container } = render(
      <div>
        <ActivitySection section={{ state: "unavailable" }} />
        <ActivitySection section={{ state: "loading" }} />
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
  it("repeated time/type identifiers retain every row with no duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const table = render(
      <ActivitySection section={readySection([
        { time: "T", type: "K", message: "a" },
        { time: "T", type: "K", message: "b" },
        { time: "T", type: "K", message: "c" },
      ])} />
    ).getByRole("table");
    expect(table.querySelectorAll("tbody tr").length).toBe(3);
    const keyWarning = spy.mock.calls.some((c) => c.some((a) => typeof a === "string" && a.includes("same key")));
    expect(keyWarning).toBe(false);
    spy.mockRestore();
  });
});

describe("ActivitySection -- accessibility & responsive semantics", () => {
  it("exposes a labelled region with a heading and a caption", () => {
    const { getByTestId, getByRole } = render(<ActivitySection section={readySection([FULL_ROW])} />);
    const region = getByTestId("activity-section");
    expect(region.tagName.toLowerCase()).toBe("section");
    const heading = getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("Activity");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(getByRole("table").querySelector("caption").textContent).toBe("Activity at this location");
  });
  it("uses column-scoped table headers in READY", () => {
    const ths = within(render(<ActivitySection section={readySection([FULL_ROW])} />).getByRole("table")).getAllByRole("columnheader");
    expect(ths.length).toBe(3);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });
  it("wraps the READY table in an overflow-x container (no mobile page overflow)", () => {
    expect(render(<ActivitySection section={readySection([FULL_ROW])} />).getByTestId("as-ready").style.overflowX).toBe("auto");
  });
});
