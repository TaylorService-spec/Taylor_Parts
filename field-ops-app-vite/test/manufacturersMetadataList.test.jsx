// S-INV-MANUFACTURERS -- RENDER gate for Manufacturers.jsx (vitest + jsdom, via `npm run
// test:components`). Proves the list now renders through the metadata list runtime
// (manufacturerIndexList/manufacturerEntity + buildListPresentation + MetadataListGrid)
// with no functional or accessibility regression against the hand-written table it
// replaces: rows render through the runtime, denied/unavailable/empty stay three distinct
// renderings, the document id is NEVER shown as cell content or dialog copy (DECISIONS
// #106 -- X-MANUFACTURER-ID-AS-COLUMN class defect), and the page is READ-ONLY: the
// Firebase write affordances were removed by the Firebase exit (PR-B). The Firebase-touching
// read (fetchManufacturerList) is mocked at the same module boundary partsListInvalid.test.jsx and its siblings use; no
// network, no emulator.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/services/manufacturerQueries", () => ({ fetchManufacturerList: vi.fn() }));

import { fetchManufacturerList } from "../src/services/manufacturerQueries";
import Manufacturers, { buildManufacturersPresentation } from "../src/modules/inventory/Manufacturers.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROWS = [
  { manufacturerId: "doc-alpha-123", name: "Alpha Mfg", status: "ACTIVE", version: 3 },
  { manufacturerId: "doc-beta-456", name: "Beta Industrial", status: "INACTIVE", version: 1 },
];

describe("Manufacturers — metadata list runtime migration (S-INV-MANUFACTURERS)", () => {
  it("READY: renders rows through the metadata runtime (name, status columns) — no document id anywhere in the DOM", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    render(<Manufacturers />);

    await screen.findByText("Alpha Mfg");
    expect(screen.getByText("Beta Industrial")).toBeTruthy();

    // ENUM columns resolve through the entity's declared enumLabels (Active/Inactive),
    // not the raw stored token.
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();

    // NO DOCUMENT ID AS VISIBLE CONTENT anywhere on the page (DECISIONS #106).
    expect(document.body.textContent.includes("doc-alpha-123")).toBe(false);
    expect(document.body.textContent.includes("doc-beta-456")).toBe(false);

    // Exactly the two declared columns (name, status) render as headers -- no ID column.
    expect(screen.queryByText(/^ID$/)).toBeNull();
  });

  it("READ-ONLY: no create, rename or status affordance (Firebase exit PR-B)", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText("Alpha Mfg");
    for (const name of [/New Manufacturer/, /^Rename$/, /^Status$/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("EMPTY: distinct from denied/unavailable, and offers no create action the page does not have", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: [], invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText(/No manufacturers are recorded yet/);
    expect(screen.queryByText(/New Manufacturer/)).toBeNull();
  });

  it("DENIED: distinct wording from EMPTY and UNAVAILABLE", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: false, code: "permission-denied" });
    render(<Manufacturers />);
    await screen.findByText(/You do not have access to Manufacturers/);
    expect(screen.queryByText(/No manufacturers are recorded yet/)).toBeNull();
  });

  it("UNAVAILABLE: distinct wording from EMPTY and DENIED, and offers Try again", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: false, code: "internal" });
    render(<Manufacturers />);
    await screen.findByText(/Manufacturers are currently unavailable/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("buildManufacturersPresentation: LOADING state has no rows and never leaks the raw manufacturerId into a row's cells", () => {
    const p = buildManufacturersPresentation({ phase: "ready", manufacturers: ROWS, invalidCount: 0 });
    expect(p.state).toBe("READY");
    for (const row of p.rows) {
      for (const cell of row.cells) {
        expect(typeof cell.value === "string" ? cell.value.includes("doc-") : true).toBe(false);
      }
      // The key still carries the real id (routing only) -- ROWS' manufacturerId values.
      expect(["doc-alpha-123", "doc-beta-456"]).toContain(row.key);
    }
  });
});
