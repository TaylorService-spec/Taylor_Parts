// LABELS & EXPORT inside the Warehouse Racking screen — integration, capability posture,
// accessibility and the structural responsive properties.
//
// The point of this file is that labels are part of the EXISTING Administration surface and inherit
// its honest states: no second route, and a denied read that says so instead of showing "0 labels".
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AdminWarehouseRacking from "../src/modules/administration/AdminWarehouseRacking.jsx";

afterEach(cleanup);

const read = (rel) => readFileSync(resolve(process.cwd(), rel), "utf8");

const WAREHOUSES = [{ id: "WH-1", name: "Phoenix" }];
const BINS = [
  { binId: "bin_a", code: "A01-001", name: null, status: "ACTIVE", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 1 },
  { binId: "bin_b", code: "A01-003", name: null, status: "ACTIVE", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3 },
];

function stubClient(over = {}) {
  return {
    listBins: vi.fn(async () => ({ bins: BINS, truncated: false })),
    previewBinCreates: vi.fn(async () => ({ rows: [] })),
    createBin: vi.fn(async () => ({ outcome: "created" })),
    renameBin: vi.fn(async () => ({ outcome: "renamed" })),
    deactivateBin: vi.fn(async () => ({ outcome: "deactivated" })),
    reactivateBin: vi.fn(async () => ({ outcome: "reactivated" })),
    ...over,
  };
}

const mount = (props = {}) => render(
  <AdminWarehouseRacking
    client={props.client ?? stubClient()}
    loadWarehouses={async () => WAREHOUSES}
    hasCapability={props.hasCapability ?? (() => true)}
  />,
);

const selectWarehouse = async () => {
  fireEvent.change(await screen.findByLabelText("Warehouse"), { target: { value: "WH-1" } });
};

describe("labels live inside the existing Warehouse Racking surface", () => {
  it("appears once a warehouse with bins is selected", async () => {
    mount();
    await selectWarehouse();
    expect(await screen.findByText("Labels & Export")).toBeTruthy();
  });

  it("reads the bins the racking screen already loaded — no extra backend call", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    // One list read for the warehouse. Labels added none.
    expect(client.listBins).toHaveBeenCalledTimes(1);
  });

  it("introduces no second route or nav entry", () => {
    const nav = read("src/navigation/navConfig.js");
    const app = read("src/App.jsx");
    expect(nav).not.toMatch(/labels|barcode/i);
    expect(app).not.toMatch(/BinLabelsAndExport/);
  });
});

describe("it inherits the honest capability posture", () => {
  it("a denied bin read shows the refusal, and no label surface at all", async () => {
    const client = stubClient({ listBins: vi.fn(async () => { throw new Error("permission-denied"); }) });
    mount({ client });
    await selectWarehouse();
    expect(await screen.findByText(/permission-denied/)).toBeTruthy();
    // Critically: a refusal is NOT rendered as an empty label set.
    expect(screen.queryByText("Labels & Export")).toBeNull();
    expect(screen.queryByText(/no bins to label/i)).toBeNull();
  });

  it("without the read capability there is no label surface and no list attempt", async () => {
    const client = stubClient();
    mount({ client, hasCapability: () => false });
    await selectWarehouse();
    await waitFor(() => expect(client.listBins).not.toHaveBeenCalled());
    expect(screen.queryByText("Labels & Export")).toBeNull();
  });

  it("read without manage still offers labels — rendering a label is a read", async () => {
    mount({ hasCapability: (id) => id === "inventory.location.bin.read" });
    await selectWarehouse();
    expect(await screen.findByText("Labels & Export")).toBeTruthy();
    expect(screen.getAllByText("Label").length).toBe(BINS.length);
    expect(screen.queryByText("Preview these bins")).toBeNull();
  });
});

describe("rename, then reprint", () => {
  it("a row Label action selects exactly that bin for printing", async () => {
    mount();
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    fireEvent.click(screen.getAllByText("Label")[0]);
    expect(await screen.findByText("Print 1 label")).toBeTruthy();
    const sheet = document.querySelector(".fo-labelsheet");
    expect(sheet.textContent).toContain("A01-001");
    expect(sheet.textContent).not.toContain("A01-003");
  });

  it("after a rename the row can produce the CURRENT label, with no reprint flag anywhere", async () => {
    const renamed = [{ ...BINS[0], code: "B02-007" }, BINS[1]];
    let call = 0;
    const client = stubClient({
      listBins: vi.fn(async () => ({ bins: call++ === 0 ? BINS : renamed })),
    });
    mount({ client });
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    fireEvent.click(screen.getAllByText("Rename")[0]);
    fireEvent.click(screen.getByText("Save name"));
    await waitFor(() => expect(client.renameBin).toHaveBeenCalled());
    fireEvent.click((await screen.findAllByText("Label"))[0]);
    // The refreshed row yields the corrected code immediately.
    await waitFor(() => expect(document.querySelector(".fo-labelsheet").textContent).toContain("B02-007"));
    const surface = read("src/modules/administration/BinLabelsAndExport.jsx");
    expect(surface).not.toMatch(/needsReprint|labelNeeded/);
  });

  it("no automatic print fires on rename", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    fireEvent.click(screen.getAllByText("Rename")[0]);
    fireEvent.click(screen.getByText("Save name"));
    await waitFor(() => expect(client.renameBin).toHaveBeenCalled());
    expect(print).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("accessibility", () => {
  it("selection, print and export are all reachable as named controls", async () => {
    mount();
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    expect(screen.getByText("Select all shown").closest("button")).toBeTruthy();
    expect(screen.getByText("Export CSV").closest("button")).toBeTruthy();
    expect(screen.getByLabelText("Include bins that are out of use")).toBeTruthy();
  });

  it("every bin in the picker is a real labelled checkbox, not a click target", async () => {
    mount();
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    const boxes = document.querySelectorAll(".fo-labels__picker input[type=checkbox]");
    expect(boxes).toHaveLength(BINS.length);
    for (const box of boxes) expect(box.closest("label")).toBeTruthy();
  });

  it("out-of-use is conveyed in words, not by colour alone", async () => {
    mount();
    await selectWarehouse();
    await screen.findByText("Labels & Export");
    fireEvent.click(screen.getByLabelText("Include bins that are out of use"));
    // No inactive bins in this fixture, so the words are what would carry it; assert the source
    // renders text rather than a bare colour class.
    const surface = read("src/modules/administration/BinLabelsAndExport.jsx");
    expect(surface).toContain("Out of use");
    expect(surface).toContain("OUT OF USE");
  });
});

describe("responsive — the structural causes of overflow", () => {
  // jsdom does not lay out, so measuring offsetWidth would be theatre. What IS assertable is the
  // structure that makes 375px safe: an auto-fill grid whose minimum track is narrower than the
  // viewport can never force the page wider than its container.
  const css = read("src/index.css");

  it("the label sheet is an auto-fill grid with a track narrower than a 375px viewport", () => {
    const rule = css.match(/\.fo-labelsheet \{[^}]*\}/)[0];
    const min = rule.match(/minmax\((\d+(?:\.\d+)?)rem/);
    expect(rule).toContain("auto-fill");
    expect(Number(min[1]) * 16).toBeLessThan(375);
  });

  it("the bin picker grid is likewise narrower than the viewport at its minimum", () => {
    const rule = css.match(/\.fo-labels__picker \{[^}]*\}/)[0];
    const min = rule.match(/minmax\((\d+(?:\.\d+)?)rem/);
    expect(rule).toContain("auto-fill");
    expect(Number(min[1]) * 16).toBeLessThan(375);
  });

  it("the human code keeps an absolute size, so a narrow grid cannot shrink it into illegibility", () => {
    const rule = css.match(/\.fo-labelsheet__code \{[^}]*\}/)[0];
    expect(rule).toMatch(/font-size: 1\.5rem/);
    expect(rule).not.toMatch(/vw|%/);
  });

  it("the control rows wrap rather than pushing the page sideways", () => {
    expect(css).toMatch(/\.fo-labels__controls,\s*\n?\s*\.fo-labels__actions \{[^}]*flex-wrap: wrap/);
  });
});
