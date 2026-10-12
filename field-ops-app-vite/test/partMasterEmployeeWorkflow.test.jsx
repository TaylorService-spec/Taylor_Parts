// CAT-1 (docs/audits/firebase-retirement-equivalence-2026-10-11): the employee's Part Master workflows against the
// REAL Catalog API contract -- not a mocked service response.
//
// The screen (PartWriteModal) runs through the real usePartMasterWrite hook, the real partMasterCommandClient and the
// real catalogApiClient.callCatalogApi. Only the network is replaced, and it answers with the exact bytes the real
// server produced for the same request (test/fixtures/catalogPartMasterContract.json, which
// functions/test/catalogPartMasterEmployeeContractPostgres.test.mjs proves against PostgreSQL). Each scenario also
// asserts the screen SENT exactly the request the server was proven against, so the contract holds in both directions.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import CONTRACT from "./fixtures/catalogPartMasterContract.json";

const hold = vi.hoisted(() => ({ held: false }));
vi.mock("../src/config/catalogMutationHold.js", async (orig) => ({ ...(await orig()), CATALOG_MUTATION_HOLD: hold }));
vi.mock("../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => ({ loading: true, errorStatus: null, result: null }),
}));

import PartWriteModal from "../src/shared/partMaster/PartWriteModal.jsx";
import { partMasterCommandClient } from "../src/services/partMasterCommandClient.js";
import { callCatalogApi } from "../src/services/catalogApiClient.js";

afterEach(() => { cleanup(); });

// The network, answering one recorded scenario. Everything above it is production code.
function wire(scenarioName) {
  const scenario = CONTRACT.scenarios[scenarioName];
  const sent = [];
  const fetchImpl = vi.fn(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), authorization: init.headers.authorization });
    return { ok: scenario.status >= 200 && scenario.status < 300, status: scenario.status, json: async () => scenario.body };
  });
  const catalog = { call: (operation, input) => callCatalogApi(operation, input, { baseUrl: "https://eos.test", getIdToken: async () => "employee-token", fetchImpl }) };
  const client = {
    createPart: (args) => partMasterCommandClient.createPart(args, { client: catalog }),
    updatePart: (args) => partMasterCommandClient.updatePart(args, { client: catalog }),
    changePartStatus: (args) => partMasterCommandClient.changePartStatus(args, { client: catalog }),
  };
  return { scenario, sent, writeDeps: { readinessOverride: true, client } };
}

const FORM = CONTRACT.scenarios.createApplied.request.input.part;
const LOADED_V1 = { ...FORM, version: 1, status: "DRAFT" };

function fillCreateForm(part = FORM) {
  fireEvent.change(screen.getByLabelText(/^part id$/i), { target: { value: part.partId } });
  fireEvent.change(screen.getByLabelText(/internal part number/i), { target: { value: part.internalPartNumber } });
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: part.name } });
  fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: part.category } });
}

async function expectSent(sent, scenario) {
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0].url).toBe(`https://eos.test${CONTRACT.route}`);
  expect(sent[0].authorization).toBe("Bearer employee-token");
  expect(sent[0].body).toEqual(scenario.request);
}

describe("New Part -- the Parts Manager creates a part", () => {
  it("a created part is reported SAVED and the list is refreshed (it used to say 'could not be completed')", async () => {
    const { scenario, sent, writeDeps } = wire("createApplied");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fillCreateForm();
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    await expectSent(sent, scenario);
    await screen.findByText("Saved.");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0]).toMatchObject({ kind: "applied", version: 1, partId: FORM.partId });
    expect(screen.queryByText(/could not be completed/i)).toBeNull();
  });

  it("an identical resend is reported as already recorded, and still refreshes", async () => {
    const { scenario, sent, writeDeps } = wire("createReplayed");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fillCreateForm();
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/already recorded/i);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("a Part ID that already exists says so; nothing is reported saved", async () => {
    const { scenario, sent, writeDeps } = wire("createExisting");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fillCreateForm(scenario.request.input.part);
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/a part already exists with that part id/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("an employee without inventory.catalog.manage is told they are not authorized", async () => {
    const { scenario, sent, writeDeps } = wire("createDenied");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fillCreateForm(scenario.request.input.part);
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/not authorized to make this change/i);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("Edit part -- the Parts Manager corrects a part", () => {
  it("an edit is reported SAVED with the new version", async () => {
    const { scenario, sent, writeDeps } = wire("updateApplied");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="edit" part={LOADED_V1} onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: scenario.request.input.changes.name } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await expectSent(sent, scenario);
    await screen.findByText("Saved.");
    expect(onSaved.mock.calls[0][0]).toMatchObject({ kind: "applied", version: 2 });
  });

  it("a stale edit tells the employee the part changed since they loaded it", async () => {
    const { scenario, sent, writeDeps } = wire("updateStale");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="edit" part={LOADED_V1} onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: scenario.request.input.changes.category } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/changed since you loaded it/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a part that no longer exists says so", async () => {
    const { scenario, sent, writeDeps } = wire("updateUnknownPart");
    render(<PartWriteModal mode="edit" part={{ ...LOADED_V1, partId: scenario.request.input.partId }} onClose={() => {}} onSaved={() => {}} writeDeps={writeDeps} />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: scenario.request.input.changes.name } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/no longer exists/i);
  });

  it("changing the control type is refused with the reason", async () => {
    const { scenario, sent, writeDeps } = wire("updateControlType");
    render(<PartWriteModal mode="edit" part={{ ...LOADED_V1, version: 2 }} onClose={() => {}} onSaved={() => {}} writeDeps={writeDeps} />);
    fireEvent.change(screen.getByLabelText(/control type/i), { target: { value: scenario.request.input.changes.controlType } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/control type can't change/i);
  });
});

describe("Change status -- the catalog administrator activates a part", () => {
  it("activating a DRAFT part is reported SAVED", async () => {
    const { scenario, sent, writeDeps } = wire("statusApplied");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="status" part={{ ...LOADED_V1, version: 2, status: "DRAFT" }} onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fireEvent.click(screen.getByRole("button", { name: /→ ACTIVE/i }));
    await expectSent(sent, scenario);
    await screen.findByText("Saved.");
    expect(onSaved.mock.calls[0][0]).toMatchObject({ kind: "applied", version: 3 });
  });

  it("a holder of manage but not activate is told they are not authorized", async () => {
    const { scenario, sent, writeDeps } = wire("statusDenied");
    const onSaved = vi.fn();
    render(<PartWriteModal mode="status" part={{ ...LOADED_V1, version: 2, status: "DRAFT" }} onClose={() => {}} onSaved={onSaved} writeDeps={writeDeps} />);
    fireEvent.click(screen.getByRole("button", { name: /→ ACTIVE/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/not authorized to make this change/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a status change on a stale copy says the part changed since it was loaded", async () => {
    const { scenario, sent, writeDeps } = wire("statusStale");
    render(<PartWriteModal mode="status" part={{ ...LOADED_V1, version: 2, status: "ACTIVE" }} onClose={() => {}} onSaved={() => {}} writeDeps={writeDeps} />);
    fireEvent.click(screen.getByRole("button", { name: /→ INACTIVE/i }));
    await expectSent(sent, scenario);
    await screen.findByText(/changed since you loaded it/i);
  });
});
