// PERM-UI: the Equipment MODEL catalog screen (Equipment -> Equipment Models tab).
//
// Offered only to a holder of equipment.model.manage; list, create and edit go through the Catalog API client
// (listEquipmentModels / createEquipmentModel / updateEquipmentModel). The client is injected, so these tests state exactly
// what the screen SENDS and how it renders the server's answer -- they decide nothing about authority themselves.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import EquipmentModels from "../src/modules/equipment/EquipmentModels.jsx";
import { equipmentModelCommands, equipmentModelWriteOutcome } from "../src/services/equipmentModelCatalogClient.js";
import { CATALOG_MUTATION_OPERATIONS, isCatalogOperation } from "../src/services/catalogApiClient.js";

afterEach(cleanup);

const HOLDER = (c) => c === "equipment.model.manage";
const MODEL = { id: "ACME--CW-100", version: 3, manufacturerId: "ACME", manufacturerName: "Acme Refrigeration", modelNumber: "CW-100",
  displayName: "Acme CW-100", family: null, subtype: null, revision: "B", status: "ACTIVE", sourceAuthority: "MANUFACTURER_CATALOG" };

/** A fake Catalog client: the list answers `models`; every write is recorded and answers `writeAnswer`. */
function fakeClient({ models = [MODEL], listAnswer, writeAnswer = { ok: true, result: { equipmentModelId: "ACME--CW-100", version: 4, replayed: false } } } = {}) {
  const calls = [];
  return {
    calls,
    call: vi.fn(async (operation, input) => {
      calls.push([operation, input]);
      if (operation === "listEquipmentModels") return listAnswer ?? { ok: true, result: { models, nextCursor: null, limit: 100 } };
      return writeAnswer;
    }),
  };
}

describe("PERM-UI: Equipment Models is offered only to equipment.model.manage holders", () => {
  it("a non-holder sees no list, no New Equipment Model, no Edit -- and the server is never asked", () => {
    const client = fakeClient();
    render(<EquipmentModels hasCapability={() => false} client={client} />);
    expect(screen.queryByRole("button", { name: /new equipment model/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
    expect(client.call).not.toHaveBeenCalled();
  });

  it("with no capability answer at all it fails closed", () => {
    const client = fakeClient();
    render(<EquipmentModels client={client} />);
    expect(screen.queryByRole("button", { name: /new equipment model/i })).toBeNull();
    expect(client.call).not.toHaveBeenCalled();
  });

  it("a holder sees the models and the New / Edit controls", async () => {
    const client = fakeClient();
    render(<EquipmentModels hasCapability={HOLDER} client={client} />);
    expect(await screen.findByText("Acme Refrigeration")).toBeTruthy();
    expect(screen.getByRole("button", { name: /new equipment model/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Acme CW-100" })).toBeTruthy();
    expect(client.calls[0]).toEqual(["listEquipmentModels", {}]);
  });
});

describe("Equipment Models: create and update send the governed operations", () => {
  it("create sends createEquipmentModel with the model fields and reloads the list on success", async () => {
    const client = fakeClient({ models: [] });
    render(<EquipmentModels hasCapability={HOLDER} client={client} />);
    await screen.findByText(/no equipment models are recorded yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new equipment model/i }));
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type("Manufacturer ID", "acme");
    type("Manufacturer name", "Acme Refrigeration");
    type("Model number", "cw 100");
    type("Display name", "Acme CW-100");
    fireEvent.click(screen.getByRole("button", { name: "Create Model" }));
    await waitFor(() => expect(client.calls.some(([op]) => op === "createEquipmentModel")).toBe(true));
    const [, input] = client.calls.find(([op]) => op === "createEquipmentModel");
    expect(input).toEqual({ model: { manufacturerId: "acme", manufacturerName: "Acme Refrigeration", modelNumber: "cw 100", displayName: "Acme CW-100",
      family: "", subtype: "", revision: "", status: "ACTIVE", sourceAuthority: "MANUFACTURER_CATALOG" } });
    // applied -> the modal closes and the list is read again
    await waitFor(() => expect(client.calls.filter(([op]) => op === "listEquipmentModels").length).toBe(2));
  });

  it("edit sends only the CHANGED fields under the row's version; identity is not editable", async () => {
    const client = fakeClient();
    render(<EquipmentModels hasCapability={HOLDER} client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Acme CW-100" }));
    expect(screen.queryByLabelText("Model number")).toBeNull();
    expect(screen.queryByLabelText("Manufacturer ID")).toBeNull();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme CW-100 Series" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(client.calls.some(([op]) => op === "updateEquipmentModel")).toBe(true));
    expect(client.calls.find(([op]) => op === "updateEquipmentModel")[1]).toEqual({
      equipmentModelId: "ACME--CW-100", expectedVersion: 3, changes: { displayName: "Acme CW-100 Series" },
    });
  });

  it("saving an edit with nothing changed sends nothing", async () => {
    const client = fakeClient();
    render(<EquipmentModels hasCapability={HOLDER} client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Acme CW-100" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByText("No changes to save.");
    expect(client.calls.some(([op]) => op === "updateEquipmentModel")).toBe(false);
  });

  it("a refused write is shown as the server's answer and nothing is reported saved", async () => {
    const client = fakeClient({ writeAnswer: { ok: false, code: "FORBIDDEN", message: "x" } });
    render(<EquipmentModels hasCapability={HOLDER} client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Acme CW-100" }));
    fireEvent.change(screen.getByLabelText("Revision"), { target: { value: "C" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await screen.findByText(/not authorized to change equipment models/i);
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("a denied list read says so rather than showing an empty catalogue", async () => {
    const client = fakeClient({ listAnswer: { ok: false, code: "FORBIDDEN", message: "x" } });
    render(<EquipmentModels hasCapability={HOLDER} client={client} />);
    await screen.findByText(/do not have access to read equipment models/i);
    expect(screen.queryByText(/no equipment models are recorded yet/i)).toBeNull();
  });
});

describe("the Equipment Model operations are on the client's closed Catalog list, and outcomes are honest", () => {
  it("createEquipmentModel and updateEquipmentModel are mutation operations", () => {
    for (const op of ["createEquipmentModel", "updateEquipmentModel"]) {
      expect(CATALOG_MUTATION_OPERATIONS).toContain(op);
      expect(isCatalogOperation(op)).toBe(true);
    }
  });

  it("commands send exactly the governed envelopes", async () => {
    const client = fakeClient();
    await equipmentModelCommands.create({ manufacturerId: "acme" }, { client });
    await equipmentModelCommands.update({ equipmentModelId: "ACME--X", expectedVersion: 1, changes: { revision: "B" } }, { client });
    expect(client.calls).toEqual([
      ["createEquipmentModel", { model: { manufacturerId: "acme" } }],
      ["updateEquipmentModel", { equipmentModelId: "ACME--X", expectedVersion: 1, changes: { revision: "B" } }],
    ]);
  });

  it("maps the server's answers without inventing a success", () => {
    expect(equipmentModelWriteOutcome({ ok: true, result: { replayed: false } }).kind).toBe("applied");
    expect(equipmentModelWriteOutcome({ ok: true, result: { replayed: true } }).kind).toBe("replayed");
    expect(equipmentModelWriteOutcome({ ok: false, code: "CONFLICT" }).kind).toBe("conflict");
    expect(equipmentModelWriteOutcome({ ok: false, code: "FORBIDDEN" }).kind).toBe("denied");
    expect(equipmentModelWriteOutcome(undefined).kind).toBe("error");
  });
});
