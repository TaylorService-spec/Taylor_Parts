// SUP-1: the employee's Part Detail "Suppliers & Terms" workflows against the REAL Operations API contract -- not a
// mocked service response.
//
// The section (PartSupplierTermsSection) runs through the real domain builders, the real partsOperationsReads calls and
// the real reorderApiClient.callReorderApi. Only the network is replaced, and it answers with the exact bytes the real
// server produced for the same requests (test/fixtures/partSupplierTermsContract.json, which
// functions/test/partSupplierTermsEmployeeContractPostgres.test.mjs proves against PostgreSQL). Every scenario also
// asserts the section SENT exactly the requests the server was proven against, so the contract holds both ways.
//
// GOVERNED FIELD GROUPS: the cost & contract terms (COMMERCIAL) are rendered from the server's `fieldAccess` + `withheld`
// ONLY. The buyer's answers carry them; the manager's and the administrator's withhold them, and the screen shows the
// restriction, hides "Add Supplier Terms", disables the COMMERCIAL inputs and never sends a COMMERCIAL key. RECORD ACCESS
// (DECISIONS #230): Add / Edit / Set Preferred / Deactivate are offered only when the server's `recordAccess` says so.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import CONTRACT from "./fixtures/partSupplierTermsContract.json";
import PartSupplierTermsSection from "../src/shared/partMaster/PartSupplierTermsSection.jsx";

afterEach(() => { cleanup(); });

const PART = CONTRACT.partId;

// The network, answering the recorded scenarios IN ORDER. Everything above it is production code.
function wire(...names) {
  const sent = [];
  let next = 0;
  const fetchImpl = vi.fn(async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), authorization: init.headers.authorization });
    const name = names[next++];
    const scenario = typeof name === "object" ? name : CONTRACT.scenarios[name];
    if (!scenario) throw new Error(`unexpected request #${next}: ${init.body}`);
    return { ok: scenario.status >= 200 && scenario.status < 300, status: scenario.status, json: async () => scenario.body };
  });
  const deps = { callOptions: { baseUrl: "https://eos.test", getIdToken: async () => "employee-token", fetchImpl } };
  return { sent, deps };
}

async function expectSent(sent, ...names) {
  await waitFor(() => expect(sent).toHaveLength(names.length));
  sent.forEach((s, n) => {
    expect(s.url).toBe(`https://eos.test${CONTRACT.route}`);
    expect(s.authorization).toBe("Bearer employee-token");
    expect(s.body).toEqual(CONTRACT.scenarios[names[n]].request);
  });
}

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const table = () => screen.getByRole("table", { name: `Supplier terms for ${PART}` });
const rowOf = (name) => within(table()).getByText(name).closest("tr");

describe("reading a Part's supplier terms", () => {
  it("lists every supplier's terms -- INACTIVE included, never hidden -- with what each offers (a cost-visible role)", async () => {
    const { sent, deps } = wire("listMixed");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByRole("table", { name: `Supplier terms for ${PART}` });
    await expectSent(sent, "listMixed");
    const arctic = rowOf("Arctic Parts Supply");
    expect(within(arctic).getByText("ARC-100")).toBeTruthy();
    expect(within(arctic).getByText("11.75 USD")).toBeTruthy();
    expect(within(arctic).getByText("10 days")).toBeTruthy();
    expect(within(arctic).getByText("1 BOX = 12 EACH")).toBeTruthy();
    expect(within(arctic).getByText("2026-01-01 – 2026-12-31")).toBeTruthy();
    expect(within(arctic).getByText("Available")).toBeTruthy();
    expect(within(arctic).getByText("Terms Active")).toBeTruthy();
    const cold = rowOf("ColdChain Components");
    expect(within(cold).getByText("Terms Inactive")).toBeTruthy();
    expect(within(cold).getByRole("button", { name: /reactivate terms from coldchain/i })).toBeTruthy();
    expect(within(cold).queryByRole("button", { name: /preferred/i })).toBeNull();
    expect(screen.queryByText(/restricted — requires cost visibility/i)).toBeNull();
    expect(screen.getByRole("button", { name: /add supplier terms/i })).toBeTruthy();
  });

  it("without cost visibility, cost & contract cells say RESTRICTED (no value is on the wire) and Add is not offered", async () => {
    const { sent, deps } = wire("listWithheld");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByRole("table", { name: `Supplier terms for ${PART}` });
    await expectSent(sent, "listWithheld");
    for (const item of CONTRACT.scenarios.listWithheld.body.result.items) expect("cost" in item).toBe(false);
    const arctic = rowOf("Arctic Parts Supply");
    expect(within(arctic).getAllByText("Restricted — requires cost visibility")).toHaveLength(2);
    expect(within(arctic).getByText("ARC-100")).toBeTruthy();
    expect(within(arctic).getByText("10 days")).toBeTruthy();
    expect(within(arctic).queryByText(/USD/)).toBeNull();
    expect(screen.queryByRole("button", { name: /add supplier terms/i })).toBeNull();
    expect(screen.getByText(/adding supplier terms sets cost & contract terms/i)).toBeTruthy();
  });

  it("a reader without catalog management authority is shown a DENIAL, not an empty list, and no controls", async () => {
    const { sent, deps } = wire("listDenied");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByText(/this is a denial, not an empty list/i);
    await expectSent(sent, "listDenied");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/no supplier terms are recorded/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /add supplier terms/i })).toBeNull();
  });
});

describe("Add supplier terms", () => {
  it("the buyer (cost create) adds a supplier's terms; the list is re-read from the server", async () => {
    const { sent, deps } = wire("listEmpty", "createApplied", "listAfterCreate");
    const input = CONTRACT.scenarios.createApplied.request.input;
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByText(/no supplier terms are recorded/i);
    fireEvent.click(screen.getByRole("button", { name: /add supplier terms/i }));
    // Only the ACTIVE suppliers without terms are offered -- the server's list, by name.
    const options = within(screen.getByLabelText("Supplier")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Select…", "Arctic Parts Supply", "ColdChain Components"]);
    type("Supplier", input.supplierId);
    type("Supplier SKU", input.supplierSku);
    type("Unit cost", input.cost);
    type("Currency", "usd");
    type("Lead time (days)", String(input.leadTimeDays));
    type("Minimum order quantity", input.minOrderQty);
    type("Order multiple", input.orderMultiple);
    type("Purchase unit", input.purchaseUnit);
    type(/^stocking units/i, String(input.conversionToStockingUnit.numerator));
    type("Purchase units per conversion", String(input.conversionToStockingUnit.denominator));
    type("Contract start", input.contractStart);
    type("Contract end", input.contractEnd);
    type("Availability", input.availability);
    fireEvent.click(screen.getByRole("button", { name: /add supplier terms/i }));
    await screen.findByText("Supplier terms added.");
    await expectSent(sent, "listEmpty", "createApplied", "listAfterCreate");
    expect(within(rowOf("Arctic Parts Supply")).getByText("12.5 USD")).toBeTruthy();
  });

  it("a term the server refuses is shown with the server's reason; nothing is reported saved", async () => {
    const { sent, deps } = wire("listAfterUpdate", "createInvalid");
    const input = CONTRACT.scenarios.createInvalid.request.input;
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /add supplier terms/i }));
    type("Supplier", input.supplierId);
    type("Supplier SKU", input.supplierSku);
    type("Unit cost", input.cost);
    type("Currency", input.currency);
    type("Lead time (days)", String(input.leadTimeDays));
    fireEvent.click(screen.getByRole("button", { name: /add supplier terms/i }));
    await screen.findByText(/refused: leadTimeDays must be an integer 0\.\.3650/i);
    await expectSent(sent, "listAfterUpdate", "createInvalid");
    expect(screen.queryByText("Supplier terms added.")).toBeNull();
    expect(screen.getByRole("form", { name: /add supplier terms/i })).toBeTruthy();
  });
});

describe("Edit terms", () => {
  it("an edit sends ONLY what changed, at the version loaded, and is reported saved", async () => {
    const { sent, deps } = wire("listAfterCreate", "updateApplied", "listAfterUpdate");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /edit terms from arctic parts supply/i }));
    type("Unit cost", "11.75");
    type("Lead time (days)", "10");
    fireEvent.click(screen.getByRole("button", { name: /save terms/i }));
    await screen.findByText("Supplier terms saved.");
    await expectSent(sent, "listAfterCreate", "updateApplied", "listAfterUpdate");
    expect(within(rowOf("Arctic Parts Supply")).getByText("11.75 USD")).toBeTruthy();
  });

  it("without cost edit, the COMMERCIAL inputs are disabled with the reason, and only ordering terms are sent", async () => {
    const { sent, deps } = wire("listWithheld", "updateOperational", "listAfterOperational");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /edit terms from arctic parts supply/i }));
    for (const label of ["Unit cost", "Currency", "Contract start", "Contract end"]) {
      expect(screen.getByLabelText(label).disabled).toBe(true);
      expect(screen.getByLabelText(label).value).toBe("");
    }
    expect(screen.getByText(/cost & contract terms can't be changed here/i)).toBeTruthy();
    expect(screen.getByLabelText("Lead time (days)").disabled).toBe(false);
    type("Lead time (days)", "14");
    type("Unit cost", "0.01"); // a disabled input the employee cannot really edit -- and even forced, it is never sent
    fireEvent.click(screen.getByRole("button", { name: /save terms/i }));
    await screen.findByText("Supplier terms saved.");
    await expectSent(sent, "listWithheld", "updateOperational", "listAfterOperational");
    expect(sent[1].body.input.changes).toEqual({ leadTimeDays: 14 });
    expect(within(rowOf("Arctic Parts Supply")).getByText("14 days")).toBeTruthy();
  });

  it("a stale edit tells the employee the terms changed since they loaded them; the form stays", async () => {
    const { sent, deps } = wire("listAfterCreate", "updateStale");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /edit terms from arctic parts supply/i }));
    type("Supplier SKU", CONTRACT.scenarios.updateStale.request.input.changes.supplierSku);
    fireEvent.click(screen.getByRole("button", { name: /save terms/i }));
    await screen.findByText(/changed since you loaded them/i);
    await expectSent(sent, "listAfterCreate", "updateStale");
    expect(screen.getByRole("form", { name: /edit supplier terms/i })).toBeTruthy();
  });
});

describe("Preferred supplier and status", () => {
  it("Set Preferred makes that supplier THE preferred one", async () => {
    const { sent, deps } = wire("listBeforePreferred", "setPreferredApplied", "listAfterPreferred");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /make coldchain components preferred/i }));
    await screen.findByText("Preferred supplier set.");
    await expectSent(sent, "listBeforePreferred", "setPreferredApplied", "listAfterPreferred");
    expect(within(rowOf("ColdChain Components")).getByText(/preferred/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /make coldchain components preferred/i })).toBeNull();
  });

  it("the catalog administrator deactivates terms; they stay listed as inactive", async () => {
    const { sent, deps } = wire("listAfterPreferredAdministrator", "statusApplied", "listMixedAdministrator");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /deactivate terms from coldchain components/i }));
    await screen.findByText("Supplier terms deactivated.");
    await expectSent(sent, "listAfterPreferredAdministrator", "statusApplied", "listMixedAdministrator");
    expect(within(rowOf("ColdChain Components")).getByText("Terms Inactive")).toBeTruthy();
    // The administrator holds no cost key: standing or title never shows cost.
    expect(within(rowOf("ColdChain Components")).getAllByText("Restricted — requires cost visibility")).toHaveLength(2);
  });

  it("a status change the server refuses (authority withdrawn after the list was read) is reported, and status controls go away", async () => {
    const { sent, deps } = wire("listAfterPreferred", "statusDenied");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    fireEvent.click(await screen.findByRole("button", { name: /deactivate terms from coldchain components/i }));
    await screen.findByText(/not authorized to make this change/i);
    await expectSent(sent, "listAfterPreferred", "statusDenied");
    expect(screen.queryByRole("button", { name: /deactivate terms from/i })).toBeNull();
    expect(screen.getByRole("button", { name: /edit terms from coldchain components/i })).toBeTruthy();
    expect(within(rowOf("ColdChain Components")).getByText("Terms Active")).toBeTruthy();
  });
});

// Security review of #2064, N3: an employee who may change cost & contract terms but cannot SEE them must never wipe a
// stored contract date by leaving one end blank.
describe("restricted contract window: both dates or neither", () => {
  it("one date alone is refused by the form and nothing is sent; both dates are sent; neither keeps the stored window", async () => {
    const { blindWindowIncomplete, buildTermsChanges } = await import("../src/domain/partSupplierTerms.js");
    const item = { itemId: "P__S", supplierSku: "SKU-1", withheld: [{ group: "COMMERCIAL", fields: ["cost", "currency", "contractStart", "contractEnd"], requires: ["inventory.catalog.cost.read"] }] };
    const access = { COMMERCIAL: { read: false, create: true, edit: true } };
    expect(blindWindowIncomplete({ contractStart: "", contractEnd: "2034-01-01" }, item)).toBe(true);
    const oneEnd = buildTermsChanges({ contractStart: "", contractEnd: "2034-01-01" }, item, access);
    expect("contractStart" in oneEnd).toBe(false);
    expect("contractEnd" in oneEnd).toBe(false);
    expect(buildTermsChanges({ contractStart: "2033-01-01", contractEnd: "2034-01-01" }, item, access))
      .toMatchObject({ contractStart: "2033-01-01", contractEnd: "2034-01-01" });
    const neither = buildTermsChanges({ supplierSku: "SKU-2" }, item, access);
    expect(neither).toEqual({ supplierSku: "SKU-2" });
    expect(blindWindowIncomplete({ contractStart: "", contractEnd: "" }, item)).toBe(false);
  });
});

describe("record access: the screen offers only what the server's recordAccess allows", () => {
  it("a maintainer without changeStatus sees Edit and Set Preferred but no Deactivate / Reactivate", async () => {
    const { sent, deps } = wire("listWithheld");
    expect(CONTRACT.scenarios.listWithheld.body.result.recordAccess.changeStatus).toBe(false);
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByRole("table", { name: `Supplier terms for ${PART}` });
    await expectSent(sent, "listWithheld");
    expect(screen.queryByRole("button", { name: /(deactivate|reactivate) terms from/i })).toBeNull();
    expect(screen.getByRole("button", { name: /edit terms from arctic parts supply/i })).toBeTruthy();
  });

  it("a lifecycle holder without create is told adding needs the add permission", async () => {
    const { sent, deps } = wire("listMixedAdministrator");
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByRole("table", { name: `Supplier terms for ${PART}` });
    await expectSent(sent, "listMixedAdministrator");
    expect(screen.queryByRole("button", { name: /add supplier terms/i })).toBeNull();
    expect(screen.getByText(/adding supplier terms needs the add-supplier-terms permission/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reactivate terms from coldchain components/i })).toBeTruthy();
  });

  it("a read-only holder (supplierTerms.read alone) sees the terms with NO Add, Edit, Set Preferred or status control", async () => {
    const base = CONTRACT.scenarios.listWithheld;
    const readOnly = { ...base, body: { ...base.body, result: { ...base.body.result,
      fieldAccess: { RELATIONSHIP: { read: true, create: false, edit: false }, OPERATIONAL: { read: true, create: false, edit: false },
        COMMERCIAL: { read: false, create: false, edit: false } },
      recordAccess: { read: true, create: false, edit: false, changeStatus: false } } } };
    const { sent, deps } = wire(readOnly);
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByRole("table", { name: `Supplier terms for ${PART}` });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(within(rowOf("Arctic Parts Supply")).getByText("ARC-100")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /edit terms from/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /preferred/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /(deactivate|reactivate) terms from/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add supplier terms/i })).toBeNull();
  });

  it("an answer without recordAccess fails closed: no write control is offered", async () => {
    const base = CONTRACT.scenarios.listMixed;
    const { recordAccess: _dropped, ...result } = base.body.result;
    const { deps } = wire({ ...base, body: { ...base.body, result } });
    render(<PartSupplierTermsSection partId={PART} partNumber={PART} deps={deps} />);
    await screen.findByRole("table", { name: `Supplier terms for ${PART}` });
    expect(screen.queryByRole("button", { name: /edit terms from|preferred|activate terms from|add supplier terms/i })).toBeNull();
  });
});
