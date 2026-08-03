// EI Mobile Inventory -- component tests for the ISOLATED, UNWIRED MobileInventorySections
// composite (vitest + jsdom + RTL). It is rendered with the REAL five section components (no
// mocks): the tests prove the composite delegates each section value to the correct component,
// keeps sections isolated, and fails the outer envelope closed -- all through public behavior.
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import MobileInventorySections, { __test__ } from "../src/modules/inventory/mobile/MobileInventorySections.jsx";

afterEach(cleanup);

// A composed model with each section in a distinct READY payload carrying a UNIQUE identifier,
// so delegation can be proven per-section. `identity` must never render (no identity leak).
const FULL_MODEL = Object.freeze({
  identity: { truckId: "TRK-SECRET", locationId: "LOC-SECRET" },
  resolved: true,
  sections: {
    parts: { state: "ready", items: [{ internalSku: "PARTS-ID" }] },
    serializedAssets: { state: "ready", items: [{ assetId: "SERIAL-ID" }] },
    reservations: { state: "ready", items: [{ order: "RESV-ID" }] },
    reconciliation: { state: "ready", observation: { expectedSerialized: 1, scannedSerialized: 1, expectedParts: 1, scannedParts: 1, missing: [{ assetId: "RECON-ID" }], unexpected: [] } },
    activity: { state: "ready", items: [{ message: "ACT-ID" }] },
  },
});

// section root test-id -> the unique identifier that must appear ONLY inside it.
const ROUTES = {
  "parts-stock-section": "PARTS-ID",
  "serialized-assets-section": "SERIAL-ID",
  "reservations-section": "RESV-ID",
  "reconciliation-section": "RECON-ID",
  "activity-section": "ACT-ID",
};

describe("MobileInventorySections -- exact delegation & isolation", () => {
  it("routes each section value to its matching component and nowhere else", () => {
    const { getByTestId } = render(<MobileInventorySections model={FULL_MODEL} />);
    for (const [rootId, ownId] of Object.entries(ROUTES)) {
      const root = getByTestId(rootId);
      expect(within(root).getByText(ownId)).toBeTruthy(); // own value present in its own section
      for (const otherId of Object.values(ROUTES)) {
        if (otherId !== ownId) expect(within(root).queryByText(otherId)).toBeNull(); // isolation
      }
    }
  });

  it("renders exactly the five section components once each, in composer order", () => {
    const { getByTestId, container } = render(<MobileInventorySections model={FULL_MODEL} />);
    const order = ["parts-stock-section", "serialized-assets-section", "reservations-section", "reconciliation-section", "activity-section"];
    for (const id of order) expect(container.querySelectorAll(`[data-testid="${id}"]`).length).toBe(1);
    // DOM order matches the composer's fixed section order
    const rendered = [...getByTestId("mis-sections").querySelectorAll(":scope > section")].map((s) => s.getAttribute("data-testid"));
    expect(rendered).toEqual(order);
  });

  it("never leaks identity (truckId/locationId) or invents content", () => {
    const html = render(<MobileInventorySections model={FULL_MODEL} />).container.innerHTML;
    expect(html.includes("TRK-SECRET")).toBe(false);
    expect(html.includes("LOC-SECRET")).toBe(false);
  });

  it("preserves five governed states independently (distinct state per section)", () => {
    const model = { sections: {
      parts: { state: "ready", items: [{ internalSku: "P1" }] },
      serializedAssets: { state: "loading" },
      reservations: { state: "denied" },
      reconciliation: { state: "error" },
      activity: { state: "unavailable" },
    } };
    const { getByTestId } = render(<MobileInventorySections model={model} />);
    expect(within(getByTestId("parts-stock-section")).getByTestId("ps-ready")).toBeTruthy();
    expect(within(getByTestId("serialized-assets-section")).getByTestId("sa-loading")).toBeTruthy();
    expect(within(getByTestId("reservations-section")).getByTestId("rs-denied")).toBeTruthy();
    expect(within(getByTestId("reconciliation-section")).getByTestId("rc-error")).toBeTruthy();
    expect(within(getByTestId("activity-section")).getByTestId("as-unavailable")).toBeTruthy();
  });

  it("a malformed value in one section does not affect the others (isolation)", () => {
    const model = { sections: {
      parts: { state: "ready", items: [{ internalSku: "STILL-HERE" }] },
      serializedAssets: { state: "ready", items: [{}] }, // malformed row -> whole section ERROR
      reservations: { state: "ready", items: [] },
      reconciliation: { state: "ready", observation: { missing: [] } }, // malformed observation -> ERROR
      activity: { state: "ready", items: [{ message: "ALSO-HERE" }] },
    } };
    const { getByTestId } = render(<MobileInventorySections model={model} />);
    expect(within(getByTestId("serialized-assets-section")).getByTestId("sa-error")).toBeTruthy();
    expect(within(getByTestId("reconciliation-section")).getByTestId("rc-error")).toBeTruthy();
    // untouched sections still render their own content
    expect(within(getByTestId("parts-stock-section")).getByText("STILL-HERE")).toBeTruthy();
    expect(within(getByTestId("activity-section")).getByText("ALSO-HERE")).toBeTruthy();
    expect(within(getByTestId("reservations-section")).getByTestId("rs-empty")).toBeTruthy();
  });

  it("a missing section KEY fails only that section closed to unavailable", () => {
    const model = { sections: { parts: { state: "ready", items: [{ internalSku: "PP" }] } } }; // only parts present
    const { getByTestId } = render(<MobileInventorySections model={model} />);
    expect(within(getByTestId("parts-stock-section")).getByText("PP")).toBeTruthy();
    for (const [rootId, testid] of [["serialized-assets-section", "sa-unavailable"], ["reservations-section", "rs-unavailable"], ["reconciliation-section", "rc-unavailable"], ["activity-section", "as-unavailable"]]) {
      expect(within(getByTestId(rootId)).getByTestId(testid)).toBeTruthy();
    }
  });

  it("empty sections object renders all five sections unavailable, no invented data", () => {
    const { getByTestId, queryByRole } = render(<MobileInventorySections model={{ sections: {} }} />);
    expect(getByTestId("mis-sections")).toBeTruthy();
    for (const testid of ["ps-unavailable", "sa-unavailable", "rs-unavailable", "rc-unavailable", "as-unavailable"]) {
      expect(getByTestId(testid)).toBeTruthy();
    }
    expect(queryByRole("table")).toBeNull(); // no fabricated tables/data
  });
});

describe("MobileInventorySections -- envelope fail-closed", () => {
  it("undefined (missing prop) -> single unavailable message, no children, no throw", () => {
    const { getByTestId, queryByTestId } = render(<MobileInventorySections />);
    expect(getByTestId("mis-unavailable")).toBeTruthy();
    expect(queryByTestId("mis-sections")).toBeNull();
    expect(queryByTestId("parts-stock-section")).toBeNull();
  });

  it.each([
    ["null", null],
    ["string", "garbage"],
    ["number", 42],
    ["array", []],
    ["sections not an object (string)", { sections: "x" }],
    ["sections null", { sections: null }],
    ["sections is an array", { sections: [] }],
    ["no sections key", { identity: {}, resolved: true }],
  ])("malformed envelope (%s) -> single unavailable message, no children", (_l, model) => {
    const { getByTestId, queryByTestId } = render(<MobileInventorySections model={model} />);
    expect(getByTestId("mis-unavailable")).toBeTruthy();
    expect(queryByTestId("mis-sections")).toBeNull();
    expect(queryByTestId("parts-stock-section")).toBeNull();
  });

  it("never throws on any malformed input", () => {
    for (const bad of [null, undefined, 0, "x", [], { sections: 5 }, { sections: {} }]) {
      expect(() => render(<MobileInventorySections model={bad} />)).not.toThrow();
      cleanup();
    }
  });
});

describe("MobileInventorySections -- accessibility, determinism, non-mutation", () => {
  it("exposes a labelled grouping region with an h2 heading", () => {
    const { getByTestId, getByRole } = render(<MobileInventorySections model={{ sections: {} }} />);
    const region = getByTestId("mobile-inventory-sections");
    expect(region.tagName.toLowerCase()).toBe("section");
    const heading = getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Mobile Inventory");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("renders identical content across two renders (all per-instance useIds normalized)", () => {
    const normalize = (html) => html.replace(/id="[^"]*"/g, 'id="X"').replace(/aria-labelledby="[^"]*"/g, 'aria-labelledby="X"');
    const a = render(<MobileInventorySections model={FULL_MODEL} />).container.innerHTML;
    cleanup();
    const b = render(<MobileInventorySections model={FULL_MODEL} />).container.innerHTML;
    expect(normalize(a)).toBe(normalize(b));
  });

  it("does not mutate the deep-frozen model", () => {
    const frozen = Object.freeze({
      identity: Object.freeze({ truckId: "T", locationId: "L" }),
      resolved: true,
      sections: Object.freeze({
        parts: Object.freeze({ state: "ready", items: Object.freeze([Object.freeze({ internalSku: "P" })]) }),
        serializedAssets: Object.freeze({ state: "unavailable" }),
        reservations: Object.freeze({ state: "unavailable" }),
        reconciliation: Object.freeze({ state: "unavailable" }),
        activity: Object.freeze({ state: "unavailable" }),
      }),
    });
    const before = JSON.stringify(frozen);
    expect(() => render(<MobileInventorySections model={frozen} />)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it("delegation map is exactly the five composer sections in order", () => {
    expect(__test__.SECTION_COMPONENTS.map((s) => s.key)).toEqual(["parts", "serializedAssets", "reservations", "reconciliation", "activity"]);
  });
});
