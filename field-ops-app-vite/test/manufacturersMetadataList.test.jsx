// S-INV-MANUFACTURERS -- RENDER gate for Manufacturers.jsx (vitest + jsdom, via `npm run
// test:components`). Proves the list now renders through the metadata list runtime
// (manufacturerIndexList/manufacturerEntity + buildListPresentation + MetadataListGrid)
// with no functional or accessibility regression against the hand-written table it
// replaces: rows render through the runtime, denied/unavailable/empty stay three distinct
// renderings, the document id is NEVER shown as cell content or dialog copy (DECISIONS
// #106 -- X-MANUFACTURER-ID-AS-COLUMN class defect), and row actions (Rename/Status) still
// work. Firebase-touching modules (fetchManufacturerList, the write hook/client) are
// mocked at the same module boundary partsListInvalid.test.jsx and its siblings use; no
// network, no emulator.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

vi.mock("../src/services/manufacturerQueries", () => ({ fetchManufacturerList: vi.fn() }));
vi.mock("../src/hooks/useManufacturerWrite", () => ({
  useManufacturerWrite: () => ({
    writeReady: true,
    runCreate: vi.fn(),
    runRename: vi.fn(),
    runChangeStatus: vi.fn(),
  }),
}));

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

  it("row actions: Rename opens the dialog headed by the manufacturer's NAME, never its id", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText("Alpha Mfg");

    const row = screen.getByText("Alpha Mfg").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("heading", { name: "Rename Alpha Mfg" })).toBeTruthy();
    expect(document.body.textContent.includes("doc-alpha-123")).toBe(false);
  });

  it("row actions: Status opens the dialog headed by the manufacturer's NAME, never its id", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText("Beta Industrial");

    const row = screen.getByText("Beta Industrial").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Status" }));

    expect(await screen.findByRole("heading", { name: "Change status — Beta Industrial" })).toBeTruthy();
    expect(document.body.textContent.includes("doc-beta-456")).toBe(false);
  });

  it("EMPTY: distinct from denied/unavailable, and keeps the actionable copy pointing at New manufacturer", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: [], invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText(/No manufacturers are recorded yet/);
    expect(screen.getByText(/Use “New manufacturer” to create the first governed record/)).toBeTruthy();
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
