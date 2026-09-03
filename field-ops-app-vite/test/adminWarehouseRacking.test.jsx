// ADMINISTRATION > WAREHOUSE RACKING — render and behaviour tests (vitest + jsdom),
// plus the bounded apply runner it drives.
//
// The load-bearing assertions are the honest ones: the screen never invents a verdict, never
// classifies a bin locally, never reports a refusal as an empty rack, and never reports a partial
// apply as a success.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import AdminWarehouseRacking from "../src/modules/administration/AdminWarehouseRacking.jsx";
import { applyProposals, summarizeApply, APPLY_CONCURRENCY } from "../src/services/rackingApply.js";
import { BIN_CALLABLES } from "../src/services/binCommandClient.js";

afterEach(cleanup);

const WAREHOUSES = [{ id: "WH-1", name: "Phoenix" }, { id: "WH-2", name: "Tucson" }];
const holdsAll = () => true;
const holdsNone = () => false;
const holds = (...ids) => (id) => ids.includes(id);

const BIN = {
  binId: "bin_abc", code: "A01-003", name: null, status: "ACTIVE",
  area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3,
};

function stubClient(over = {}) {
  return {
    listBins: vi.fn(async () => ({ bins: [BIN], truncated: false })),
    previewBinCreates: vi.fn(async ({ proposals }) => ({
      rows: proposals.map((p) => ({
        idempotencyKey: p.idempotencyKey,
        code: `${p.aisle}0${p.bay}-00${p.position}`,
        classification: "NEW",
        reason: null,
      })),
    })),
    createBin: vi.fn(async (req) => ({ outcome: "created", binId: `bin_${req.idempotencyKey}`, code: "A01-001" })),
    renameBin: vi.fn(async () => ({ outcome: "renamed" })),
    deactivateBin: vi.fn(async () => ({ outcome: "deactivated" })),
    reactivateBin: vi.fn(async () => ({ outcome: "reactivated" })),
    ...over,
  };
}

const mount = (props = {}) => render(
  <AdminWarehouseRacking
    client={props.client ?? stubClient()}
    loadWarehouses={props.loadWarehouses ?? (async () => WAREHOUSES)}
    hasCapability={props.hasCapability ?? holdsAll}
  />,
);

const selectWarehouse = async (id = "WH-1") => {
  const select = await screen.findByLabelText("Warehouse");
  fireEvent.change(select, { target: { value: id } });
};

const describeRack = ({ area = "parts room", bays = "1", positions = "2" } = {}) => {
  fireEvent.change(screen.getByLabelText("Area"), { target: { value: area } });
  fireEvent.change(screen.getByLabelText("From aisle"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("To aisle"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Bays in each aisle"), { target: { value: bays } });
  fireEvent.change(screen.getByLabelText("Positions in each bay"), { target: { value: positions } });
};

describe("capability posture is stated, independently, and never faked", () => {
  it("says which capability is missing rather than showing an empty rack", async () => {
    mount({ hasCapability: holdsNone });
    expect(await screen.findByText(/is not available to you/)).toBeTruthy();
    expect(screen.getByText("inventory.location.bin.read")).toBeTruthy();
  });

  it("does not attempt the bin list without the read capability", async () => {
    const client = stubClient();
    mount({ client, hasCapability: holdsNone });
    await selectWarehouse();
    await waitFor(() => expect(client.listBins).not.toHaveBeenCalled());
  });

  it("read without manage shows the rack but offers no way to change it", async () => {
    const client = stubClient();
    mount({ client, hasCapability: holds("inventory.location.bin.read") });
    await selectWarehouse();
    // Scoped to the racking table: BIN-P5 renders the same code again in the label picker below.
    await waitFor(() => expect(document.querySelector("table.fo-table")).toBeTruthy());
    expect(within(document.querySelector("table.fo-table")).getByText("A01-003")).toBeTruthy();
    expect(screen.getByText("inventory.location.bin.manage")).toBeTruthy();
    expect(screen.queryByText("Preview these bins")).toBeNull();
    expect(screen.getAllByText("View only").length).toBeGreaterThan(0);
  });

  it("an absent capability previewer fails closed", async () => {
    // No previewer at all — the posture must be "no", never an optimistic default.
    render(<AdminWarehouseRacking client={stubClient()} loadWarehouses={async () => WAREHOUSES} />);
    expect(await screen.findByText(/is not available to you/)).toBeTruthy();
  });
});

describe("the bin list", () => {
  it("a refused read is shown as a refusal, never as 'no bins'", async () => {
    const client = stubClient({ listBins: vi.fn(async () => { throw new Error("permission-denied"); }) });
    mount({ client });
    await selectWarehouse();
    expect(await screen.findByText(/permission-denied/)).toBeTruthy();
    expect(screen.queryByText(/No bins are configured/)).toBeNull();
  });

  it("an genuinely empty warehouse says so", async () => {
    const client = stubClient({ listBins: vi.fn(async () => ({ bins: [] })) });
    mount({ client });
    await selectWarehouse();
    expect(await screen.findByText(/No bins are configured/)).toBeTruthy();
  });

  it("changing warehouse re-reads that warehouse's bins", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse("WH-1");
    await waitFor(() => expect(client.listBins).toHaveBeenCalledWith({ warehouseId: "WH-1" }));
    await selectWarehouse("WH-2");
    await waitFor(() => expect(client.listBins).toHaveBeenCalledWith({ warehouseId: "WH-2" }));
  });
});

describe("preview is the registry's answer, never the client's guess", () => {
  it("generating asks the server about every proposed bin", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    describeRack({ bays: "2", positions: "2" });
    fireEvent.click(screen.getByText("Preview these bins"));
    await waitFor(() => expect(client.previewBinCreates).toHaveBeenCalledTimes(1));
    expect(client.previewBinCreates.mock.calls[0][0].proposals).toHaveLength(4);
  });

  it("the request carries no code and no binId — the server authors both", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    describeRack();
    fireEvent.click(screen.getByText("Preview these bins"));
    await waitFor(() => expect(client.previewBinCreates).toHaveBeenCalled());
    for (const p of client.previewBinCreates.mock.calls[0][0].proposals) {
      expect(p).not.toHaveProperty("code");
      expect(p).not.toHaveProperty("binId");
      expect(p.idempotencyKey).toMatch(/^binadm:v1:WH-1:PARTS_ROOM:A:/);
    }
  });

  it("the code shown is the server's, not one rendered locally", async () => {
    const client = stubClient({
      previewBinCreates: vi.fn(async ({ proposals }) => ({
        rows: proposals.map((p) => ({ idempotencyKey: p.idempotencyKey, code: "SERVER-SAYS", classification: "NEW", reason: null })),
      })),
    });
    mount({ client });
    await selectWarehouse();
    describeRack({ positions: "1" });
    fireEvent.click(screen.getByText("Preview these bins"));
    expect(await screen.findByText("SERVER-SAYS")).toBeTruthy();
  });

  it("a failed preview shows the failure and classifies nothing", async () => {
    const client = stubClient({ previewBinCreates: vi.fn(async () => { throw new Error("unavailable"); }) });
    mount({ client });
    await selectWarehouse();
    describeRack();
    fireEvent.click(screen.getByText("Preview these bins"));
    expect(await screen.findByText(/unavailable/)).toBeTruthy();
    expect(screen.queryByText("Will be created.")).toBeNull();
  });

  it("each classification is rendered as words, and a reserved code is not offered for creation", async () => {
    const client = stubClient({
      previewBinCreates: vi.fn(async ({ proposals }) => ({
        rows: proposals.map((p, i) => ({
          idempotencyKey: p.idempotencyKey,
          code: `C-${i}`,
          classification: ["NEW", "CODE_RESERVED"][i] ?? "ALREADY_EXISTS",
          reason: null,
        })),
      })),
    });
    mount({ client });
    await selectWarehouse();
    describeRack({ positions: "2" });
    fireEvent.click(screen.getByText("Preview these bins"));
    expect((await screen.findAllByText("Code taken")).length).toBeGreaterThan(0);
    // Only the NEW row is creatable.
    expect(screen.getByText("Create 1 bin")).toBeTruthy();
  });

  it("editing the description invalidates the preview rather than leaving a stale verdict", async () => {
    mount();
    await selectWarehouse();
    describeRack();
    fireEvent.click(screen.getByText("Preview these bins"));
    expect(await screen.findByText("Preview")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Bays in each aisle"), { target: { value: "3" } });
    await waitFor(() => expect(screen.queryByText("Preview")).toBeNull());
  });

  it("a bin added by hand uses the same deterministic key the generator would", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "PARTS_ROOM" } });
    fireEvent.change(screen.getByLabelText("Aisle"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Bay"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Preview this bin"));
    await waitFor(() => expect(client.previewBinCreates).toHaveBeenCalled());
    expect(client.previewBinCreates.mock.calls[0][0].proposals[0].idempotencyKey)
      .toBe("binadm:v1:WH-1:PARTS_ROOM:A:1:2");
  });
});

describe("apply", () => {
  it("creates only the NEW rows, one governed create each", async () => {
    const client = stubClient({
      previewBinCreates: vi.fn(async ({ proposals }) => ({
        rows: proposals.map((p, i) => ({
          idempotencyKey: p.idempotencyKey, code: `C-${i}`,
          classification: i === 0 ? "NEW" : "ALREADY_EXISTS", reason: null,
        })),
      })),
    });
    mount({ client });
    await selectWarehouse();
    describeRack({ positions: "2" });
    fireEvent.click(screen.getByText("Preview these bins"));
    fireEvent.click(await screen.findByText("Create 1 bin"));
    await waitFor(() => expect(client.createBin).toHaveBeenCalledTimes(1));
  });

  it("a partial failure is reported per row, never as an overall success", async () => {
    let n = 0;
    const client = stubClient({
      createBin: vi.fn(async () => {
        n += 1;
        if (n === 2) throw new Error("code A01-003 is already reserved");
        return { outcome: "created", binId: `bin_${n}`, code: `C-${n}` };
      }),
    });
    mount({ client });
    await selectWarehouse();
    describeRack({ positions: "3" });
    fireEvent.click(screen.getByText("Preview these bins"));
    fireEvent.click(await screen.findByText("Create 3 bins"));
    expect(await screen.findByText(/already reserved/)).toBeTruthy();
    // Both outcomes stand side by side. There is no aggregate verdict to read instead.
    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not created").length).toBeGreaterThan(0);
  });

  it("applying re-reads the bin list, so the screen reflects what is stored", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    describeRack({ positions: "1" });
    const before = client.listBins.mock.calls.length;
    fireEvent.click(screen.getByText("Preview these bins"));
    fireEvent.click(await screen.findByText("Create 1 bin"));
    await waitFor(() => expect(client.listBins.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("existing bins can be renamed and retired, never deleted", () => {
  it("renaming keeps the binId — it is a code move, not a new bin", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    fireEvent.click(await screen.findByText("Rename"));
    fireEvent.change(screen.getByLabelText("Name for A01-003"), { target: { value: "Fast movers" } });
    fireEvent.click(screen.getByText("Save name"));
    await waitFor(() => expect(client.renameBin).toHaveBeenCalledWith({ binId: "bin_abc", name: "Fast movers" }));
  });

  it("deactivate and reactivate are the only retirement affordances", async () => {
    const client = stubClient();
    mount({ client });
    await selectWarehouse();
    fireEvent.click(await screen.findByText("Deactivate"));
    await waitFor(() => expect(client.deactivateBin).toHaveBeenCalledWith({ binId: "bin_abc" }));
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText(/release/i)).toBeNull();
  });
});

describe("what this screen refuses to be", () => {
  it("it never mentions quantity, stock or custody", async () => {
    mount();
    await selectWarehouse();
    await waitFor(() => expect(document.querySelector("table.fo-table")).toBeTruthy());
    for (const word of [/on hand/i, /quantity/i, /in stock/i, /custody/i]) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });

  it("it offers no control over the code format", async () => {
    mount();
    await selectWarehouse();
    expect(screen.queryByText(/bay width/i)).toBeNull();
    expect(screen.queryByText(/separator/i)).toBeNull();
  });

  it("the preview callable is the registered one", () => {
    expect(BIN_CALLABLES.preview).toBe("previewBinCreates");
  });
});

describe("the bounded apply runner", () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ request: { idempotencyKey: `k-${i}` } }));

  it("preserves input order regardless of completion order", async () => {
    const createBin = async (req) => {
      await new Promise((r) => setTimeout(r, req.idempotencyKey === "k-0" ? 20 : 0));
      return { outcome: "created", code: req.idempotencyKey };
    };
    const results = await applyProposals({ rows: rows(4), createBin });
    expect(results.map((r) => r.idempotencyKey)).toEqual(["k-0", "k-1", "k-2", "k-3"]);
  });

  it("never exceeds its concurrency bound", async () => {
    let live = 0;
    let peak = 0;
    const createBin = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return { outcome: "created" };
    };
    await applyProposals({ rows: rows(20), createBin });
    expect(peak).toBeLessThanOrEqual(APPLY_CONCURRENCY);
  });

  it("one failure does not abandon the remaining bins", async () => {
    const createBin = async (req) => {
      if (req.idempotencyKey === "k-1") throw new Error("nope");
      return { outcome: "created" };
    };
    const results = await applyProposals({ rows: rows(5), createBin });
    expect(summarizeApply(results)).toMatchObject({ created: 4, failed: 1 });
  });

  it("a replay is a success, because the bin the operator wanted is there", async () => {
    const results = await applyProposals({
      rows: rows(1),
      createBin: async () => ({ outcome: "unchanged", code: "A01-001" }),
    });
    expect(results[0].outcome).toBe("unchanged");
    expect(summarizeApply(results)).toMatchObject({ created: 0, unchanged: 1, failed: 0 });
  });

  it("an empty plan is a no-op, not a hang", async () => {
    expect(await applyProposals({ rows: [], createBin: async () => ({}) })).toEqual([]);
  });
});
