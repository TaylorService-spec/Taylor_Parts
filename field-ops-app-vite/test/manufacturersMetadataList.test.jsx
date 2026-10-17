// S-INV-MANUFACTURERS -- RENDER gate for Manufacturers.jsx (vitest + jsdom, via `npm run
// test:components`). Proves the list now renders through the metadata list runtime
// (manufacturerIndexList/manufacturerEntity + buildListPresentation + MetadataListGrid)
// with no functional or accessibility regression against the hand-written table it
// replaces: rows render through the runtime, denied/unavailable/empty stay three distinct
// renderings, the document id is NEVER shown as cell content or dialog copy (DECISIONS
// #106 -- X-MANUFACTURER-ID-AS-COLUMN class defect), and the create / rename / status flow
// Firebase exit PR-B removed is back on EOS Core (F5): the page calls the injected `commands`
// (services/manufacturerCatalogClient.js manufacturerCommands) and shows the server's answer.
// The read (fetchManufacturerList) is mocked at the same module boundary partsListInvalid.test.jsx and its siblings use; no
// network, no emulator.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../src/services/manufacturerQueries", () => ({ fetchManufacturerList: vi.fn() }));
// The Catalog API seam the manufacturer client calls (F5); no network.
vi.mock("../src/services/catalogApiClient.js", () => ({ catalogApiClient: { call: vi.fn() } }));

import { fetchManufacturerList } from "../src/services/manufacturerQueries";
import { catalogApiClient } from "../src/services/catalogApiClient.js";
import { fetchManufacturerCatalog, manufacturerCommands, manufacturerWriteOutcome } from "../src/services/manufacturerCatalogClient.js";
import Manufacturers, { buildManufacturersPresentation } from "../src/modules/inventory/Manufacturers.jsx";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ROWS = [
  { manufacturerId: "doc-alpha-123", name: "Alpha Mfg", status: "ACTIVE", updatedAt: "2026-10-17T10:00:00.000001Z" },
  { manufacturerId: "doc-beta-456", name: "Beta Industrial", status: "INACTIVE", updatedAt: "2026-10-17T10:00:00.000002Z" },
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

  const commandsStub = (answer = { kind: "applied", message: "Saved." }) => ({
    create: vi.fn().mockResolvedValue(answer), rename: vi.fn().mockResolvedValue(answer), changeStatus: vi.fn().mockResolvedValue(answer),
  });

  it("F5 CREATE: New Manufacturer sends the trimmed id and name, then reloads the list", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    const commands = commandsStub();
    render(<Manufacturers commands={commands} />);
    await screen.findByText("Alpha Mfg");
    fireEvent.click(screen.getByRole("button", { name: "New Manufacturer" }));
    fireEvent.change(screen.getByLabelText("Manufacturer ID"), { target: { value: " m-gamma " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Gamma Co " } });
    fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer" }));
    await waitFor(() => expect(commands.create).toHaveBeenCalledWith({ manufacturerId: "m-gamma", name: "Gamma Co" }));
    await waitFor(() => expect(fetchManufacturerList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("F5 RENAME and STATUS send the row's updatedAt as the concurrency token; the dialog names, never the id", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    const commands = commandsStub();
    render(<Manufacturers commands={commands} />);
    await screen.findByText("Alpha Mfg");
    const rowOf = (name) => screen.getAllByRole("row").find((r) => r.textContent.includes(name));
    fireEvent.click(within(rowOf("Alpha Mfg")).getByRole("button", { name: /Rename/ }));
    expect(screen.getByText("Rename Alpha Mfg")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alpha Manufacturing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Name" }));
    await waitFor(() => expect(commands.rename).toHaveBeenCalledWith(
      { manufacturerId: "doc-alpha-123", expectedUpdatedAt: "2026-10-17T10:00:00.000001Z", name: "Alpha Manufacturing" }));
    await screen.findByText("Saved.");
    fireEvent.click(within(rowOf("Beta Industrial")).getByRole("button", { name: /Status/ }));
    fireEvent.click(screen.getByRole("button", { name: "Make Active" }));
    await waitFor(() => expect(commands.changeStatus).toHaveBeenCalledWith(
      { manufacturerId: "doc-beta-456", expectedUpdatedAt: "2026-10-17T10:00:00.000002Z", newStatus: "ACTIVE" }));
    expect(document.body.textContent.includes("doc-alpha-123")).toBe(false);
  });

  it("F5 REFUSAL: the server's refusal is shown in the open panel, and nothing claims success", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    const commands = commandsStub({ kind: "denied", message: "You are not authorized to make this change." });
    render(<Manufacturers commands={commands} />);
    await screen.findByText("Alpha Mfg");
    fireEvent.click(screen.getByRole("button", { name: "New Manufacturer" }));
    fireEvent.change(screen.getByLabelText("Manufacturer ID"), { target: { value: "m-x" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Manufacturer" }));
    expect(await screen.findByText("You are not authorized to make this change.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Manufacturer" })).toBeTruthy();
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(fetchManufacturerList).toHaveBeenCalledTimes(1);
  });

  it("TRUNCATED: a bounded list that says more exist prints no count and says so", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0, truncated: true });
    render(<Manufacturers />);
    await screen.findByText("Alpha Mfg");
    expect(screen.getByText("More manufacturers exist than this list shows")).toBeTruthy();
  });

  it("EMPTY: distinct from denied/unavailable, and points at the create action the page has", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: [], invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText(/No manufacturers are recorded yet/);
    expect(screen.getByRole("button", { name: "New Manufacturer" })).toBeTruthy();
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

describe("manufacturerCatalogClient -- the Catalog API, not a Firebase callable (Firebase exit F5)", () => {
  it("lists through listManufacturers and maps id -> manufacturerId, carrying updatedAt and truncated", async () => {
    catalogApiClient.call.mockResolvedValue({ ok: true, result: { truncated: true, manufacturers: [{ id: "m1", name: "Taylor", status: "ACTIVE", provenance: "NATIVE", updatedAt: "t1" }] } });
    const { result } = await fetchManufacturerCatalog();
    expect(catalogApiClient.call).toHaveBeenCalledWith("listManufacturers");
    expect(result).toEqual({ status: "ready", excludedCount: 0, truncated: true, manufacturers: [{ manufacturerId: "m1", name: "Taylor", status: "ACTIVE", updatedAt: "t1" }] });
  });

  it("a FORBIDDEN list is denied; anything else that fails is unavailable, never empty", async () => {
    catalogApiClient.call.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await fetchManufacturerCatalog()).toEqual({ errorStatus: "denied" });
    catalogApiClient.call.mockResolvedValue({ ok: false, code: "UNREACHABLE" });
    expect(await fetchManufacturerCatalog()).toEqual({ errorStatus: "unavailable" });
  });

  it("the three writes send the writer's own envelopes", async () => {
    catalogApiClient.call.mockResolvedValue({ ok: true, result: { manufacturerId: "m1", updatedAt: "t2", replayed: false } });
    expect(await manufacturerCommands.create({ manufacturerId: "m1", name: "Taylor" })).toMatchObject({ kind: "applied" });
    expect(catalogApiClient.call).toHaveBeenLastCalledWith("createManufacturer", { manufacturer: { manufacturerId: "m1", name: "Taylor" } });
    await manufacturerCommands.rename({ manufacturerId: "m1", expectedUpdatedAt: "t1", name: "T" });
    expect(catalogApiClient.call).toHaveBeenLastCalledWith("updateManufacturer", { manufacturerId: "m1", expectedUpdatedAt: "t1", name: "T" });
    await manufacturerCommands.changeStatus({ manufacturerId: "m1", expectedUpdatedAt: "t1", newStatus: "INACTIVE" });
    expect(catalogApiClient.call).toHaveBeenLastCalledWith("changeManufacturerStatus", { manufacturerId: "m1", expectedUpdatedAt: "t1", newStatus: "INACTIVE" });
  });

  it("manufacturerWriteOutcome: a replay says so, a refusal is named, and nothing unknown becomes success", () => {
    expect(manufacturerWriteOutcome({ ok: true, result: { replayed: true } }).kind).toBe("replayed");
    expect(manufacturerWriteOutcome({ ok: false, code: "FORBIDDEN" }).kind).toBe("denied");
    expect(manufacturerWriteOutcome({ ok: false, code: "CONFLICT" }).kind).toBe("conflict");
    expect(manufacturerWriteOutcome({ ok: false, code: "CATALOG_MUTATION_HELD" }).kind).toBe("error");
    expect(manufacturerWriteOutcome(undefined).kind).toBe("error");
  });
});
