from ed import edit
p = "test/manufacturersMetadataList.test.jsx"
edit(p, [
("""// #106 -- X-MANUFACTURER-ID-AS-COLUMN class defect), and the page is READ-ONLY: the
// Firebase write affordances were removed by the Firebase exit (PR-B). The Firebase-touching
// read (fetchManufacturerList) is mocked at the same module boundary partsListInvalid.test.jsx and its siblings use; no
// network, no emulator.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";""",
"""// #106 -- X-MANUFACTURER-ID-AS-COLUMN class defect), and the create / rename / status flow
// Firebase exit PR-B removed is back on EOS Core (F5): the page calls the injected `commands`
// (services/manufacturerCatalogClient.js manufacturerCommands) and shows the server's answer.
// The read (fetchManufacturerList) is mocked at the same module boundary partsListInvalid.test.jsx and its siblings use; no
// network, no emulator.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";"""),
("""  { manufacturerId: "doc-alpha-123", name: "Alpha Mfg", status: "ACTIVE", version: 3 },
  { manufacturerId: "doc-beta-456", name: "Beta Industrial", status: "INACTIVE", version: 1 },""",
"""  { manufacturerId: "doc-alpha-123", name: "Alpha Mfg", status: "ACTIVE", updatedAt: "2026-10-17T10:00:00.000001Z" },
  { manufacturerId: "doc-beta-456", name: "Beta Industrial", status: "INACTIVE", updatedAt: "2026-10-17T10:00:00.000002Z" },"""),
("""  it("READ-ONLY: no create, rename or status affordance (Firebase exit PR-B)", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: ROWS, invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText("Alpha Mfg");
    for (const name of [/New Manufacturer/, /^Rename$/, /^Status$/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });""",
"""  const commandsStub = (answer = { kind: "applied", message: "Saved." }) => ({
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
    fireEvent.click(screen.getAllByRole("button", { name: /^Rename/ })[0]);
    expect(screen.getByText("Rename Alpha Mfg")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alpha Manufacturing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Name" }));
    await waitFor(() => expect(commands.rename).toHaveBeenCalledWith(
      { manufacturerId: "doc-alpha-123", expectedUpdatedAt: "2026-10-17T10:00:00.000001Z", name: "Alpha Manufacturing" }));
    await screen.findByText("Saved.");
    fireEvent.click(screen.getAllByRole("button", { name: /^Status/ })[1]);
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
  });"""),
("""  it("EMPTY: distinct from denied/unavailable, and offers no create action the page does not have", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: [], invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText(/No manufacturers are recorded yet/);
    expect(screen.queryByText(/New Manufacturer/)).toBeNull();
  });""",
"""  it("EMPTY: distinct from denied/unavailable, and points at the create action the page has", async () => {
    fetchManufacturerList.mockResolvedValue({ ok: true, manufacturers: [], invalidCount: 0 });
    render(<Manufacturers />);
    await screen.findByText(/No manufacturers are recorded yet/);
    expect(screen.getByRole("button", { name: "New Manufacturer" })).toBeTruthy();
  });"""),
])
