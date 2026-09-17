// CRM CUTOVER (client), PLATFORM-SANDBOX BUILD: Account / Contact / customer-site business reads and writes go ONLY
// to the EOS API (POST /crm/customer, governed PostgreSQL CRM). Provenance is the SERVER's; no Firestore write, no
// fallback.
//
// This suite runs the app's PUBLIC CRM modules as a platform-sandbox build selects them. The routed modules read the
// build-time define `__APP_CRM_VIA_EOS_API__` (see src/domain/crmAuthorityRoute.js); vitest.config.js deliberately
// does not define it, so every other suite exercises the legacy Firestore path exactly as before. Here it is set to
// `true` on globalThis BEFORE any CRM module is imported -- the same boolean vite.config.js bakes into a
// platform-sandbox bundle -- and every CRM module below is imported dynamically after that.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderHook, render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

globalThis.__APP_CRM_VIA_EOS_API__ = true;

const mockAuth = { currentUser: { uid: "firebase-uid-1", getIdToken: async () => "id-token" } };
vi.mock("../src/firebase/firebase", () => ({ db: {}, auth: mockAuth }));
vi.mock("../src/firebase/firebase.js", () => ({ db: {}, auth: mockAuth }));
const firestoreCalls = [];
// Every Firestore SDK export records a call. `then` and symbols are excluded so the module namespace is not mistaken for
// a thenable (the legacy implementations still import this SDK; a platform-sandbox selection must never call it).
vi.mock("firebase/firestore", () => new Proxy({}, {
  has: (_t, name) => name !== "then" && typeof name !== "symbol",
  get: (_t, name) => (name === "then" || typeof name === "symbol" ? undefined : (...args) => { firestoreCalls.push(name); return {}; }),
}));
// NOTE: the legacy stores (makeCollectionStore) build a collection reference when their module loads; that is not a
// read or write. `firestoreCalls` is reset before every test, so each assertion below covers only what the
// platform-sandbox selection does at call time.

const calls = [];
let reply = (operation, input) => ({ ok: true, result: {} });
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, headers: init.headers, ...body });
  const res = reply(body.operation, body.input);
  return { status: res.ok ? 200 : (res.status ?? 400), json: async () => res };
};

// The Account form's collaborators, stubbed: the signed-in session, the directory, and the governed owner picker (two
// buttons: pick Employee e-2, or clear the selection). Eligibility is the picker's, unchanged.
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u-9" }, employeeId: "e-9", displayName: "Admin Nine", loading: false }),
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    byUserId: new Map(),
    byEmployeeId: new Map([["e-1", { displayName: "Ada One" }], ["e-2", { displayName: "Bea Two" }]]),
    loading: false,
    error: null,
  }),
}));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({
  default: ({ onSelect }) => (
    <>
      <button type="button" onClick={() => onSelect({ employeeId: "e-2", userId: "u-2", displayName: "Bea Two" })}>Pick Bea</button>
      <button type="button" onClick={() => onSelect(null)}>Unpick</button>
    </>
  ),
}));
import.meta.env.VITE_EOS_API_BASE_URL = "https://eos-api.example";

const accounts = await import("../src/domain/accounts.js");
const contacts = await import("../src/domain/contacts.js");
const locations = await import("../src/domain/locations.js");
const { importContacts } = await import("../src/domain/contactImport.js");
const crmList = await import("../src/metadata/crmListSource.js");
const { default: AccountForm } = await import("../src/modules/accounts/AccountForm.jsx");
const { default: ContactImportModal } = await import("../src/modules/accounts/ContactImportModal.jsx");
const { newContactImportKey } = await import("../src/domain/contactImport.js");
const { crmRefusalMessage } = await import("../src/domain/crmRefusal.js");
const { default: AccountOwnershipHistorySection } = await import("../src/modules/accounts/crm/eosApi/AccountOwnershipHistorySection.jsx");
const { useLocation } = await import("../src/hooks/useLocation.js");
const { useAccountNamesWithStatus, ACCOUNT_NAMES_STATUS } = await import("../src/hooks/useAccountNames.js");
const { accountEntity, accountIndexList } = await import("../src/metadata/definitions/account.js");
const { validateEntityDefinition } = await import("../src/metadata/entityDefinition.js");
const { validateListViewDefinition } = await import("../src/metadata/listViewDefinition.js");
const { resolveOwnerIdentity, isCompleteAccountOwner } = await import("../src/domain/commercialProfile.js");

const ACCOUNT = { accountId: "acct_1", name: "Mesquite", status: "ACTIVE", ownerEmployeeId: "e-1", tags: [], relationshipTypes: [], lineOfBusiness: [], createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z", createdBy: "p-1", updatedBy: "p-1" };

afterEach(cleanup);

beforeEach(() => {
  calls.length = 0;
  firestoreCalls.length = 0;
  reply = () => ({ ok: true, result: {} });
});

describe("writers use the CRM route only", () => {
  it("createAccount sends an explicit owner, an idempotency key and governed fields; no Firestore; no client provenance", async () => {
    reply = () => ({ ok: true, result: ACCOUNT });
    const row = await accounts.createAccount({ name: "Mesquite", status: "ACTIVE", nameLower: "mesquite", accountOwner: { assignedToEmployeeId: "e-1", assignedToUserId: "u-1" }, billingContact: null, tags: ["VIP"] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://eos-api.example/crm/customer");
    expect(calls[0].headers.authorization).toBe("Bearer id-token");
    expect(calls[0].operation).toBe("createAccount");
    expect(calls[0].input).toMatchObject({ ownerEmployeeId: "e-1", name: "Mesquite", status: "ACTIVE", tags: ["VIP"] });
    expect(typeof calls[0].input.idempotencyKey).toBe("string");
    for (const f of ["nameLower", "accountOwner", "createdBy", "updatedBy", "createdAt", "updatedAt", "tenantId", "uid"]) expect(calls[0].input).not.toHaveProperty(f);
    expect(row).toMatchObject({ id: "acct_1", name: "Mesquite", accountOwner: { assignedToEmployeeId: "e-1", source: "EOS_CRM" } });
    expect(firestoreCalls).toEqual([]);
  });

  it("a refusal is thrown to the caller, never retried against Firestore", async () => {
    reply = () => ({ ok: false, code: "OWNER_REQUIRED", message: "an Account requires an explicit owner" });
    await expect(accounts.createAccount({ name: "No owner", status: "ACTIVE" })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    expect(firestoreCalls).toEqual([]);
  });

  it("updateAccount: an unchanged owner sends no owner fields; business fields only", async () => {
    reply = () => ({ ok: true, result: ACCOUNT });
    await accounts.updateAccount("acct_1", {
      name: "X", accountOwner: { assignedToEmployeeId: "e-1", source: "EOS_CRM" }, billingContact: { contactId: "cont_1" },
      ownershipChange: { previousOwnerEmployeeId: "e-1", source: "ADMIN_CORRECTION", reason: "ignored" },
    });
    expect(calls.map((c) => c.operation)).toEqual(["updateAccount"]);
    expect(calls[0].input).toEqual({ accountId: "acct_1", name: "X", billingContactId: "cont_1" });
  });

  it("updateAccount: owned -> different owner is an OWNER_HANDOFF with the stated source and reason, in ONE call", async () => {
    reply = () => ({ ok: true, result: { ...ACCOUNT, ownerEmployeeId: "e-2" } });
    const row = await accounts.updateAccount("acct_1", {
      name: "X", accountOwner: { assignedToEmployeeId: "e-2" },
      ownershipChange: { previousOwnerEmployeeId: "e-1", source: "CUSTOMER_HANDOFF_REVIEW", reason: "  territory change " },
    });
    expect(calls.map((c) => c.operation)).toEqual(["updateAccount"]);
    expect(calls[0].input).toEqual({
      accountId: "acct_1", name: "X", ownerEmployeeId: "e-2", expectedCurrentOwnerEmployeeId: "e-1",
      ownershipHandoff: { source: "CUSTOMER_HANDOFF_REVIEW", reason: "territory change" },
    });
    expect(row.ownerEmployeeId).toBe("e-2");
  });

  it("updateAccount: ownerless -> owner is an INITIAL_OWNER_ASSIGNMENT and never sends a source", async () => {
    reply = () => ({ ok: true, result: ACCOUNT });
    await accounts.updateAccount("acct_1", {
      accountOwner: { assignedToEmployeeId: "e-1" }, ownershipChange: { previousOwnerEmployeeId: null, source: "DIRECT_HANDOFF", reason: "" },
    });
    await accounts.updateAccount("acct_1", {
      accountOwner: { assignedToEmployeeId: "e-1" }, ownershipChange: { previousOwnerEmployeeId: null, source: "ADMIN_CORRECTION", reason: "remediation" },
    });
    expect(calls[0].input).toEqual({ accountId: "acct_1", ownerEmployeeId: "e-1", expectedCurrentOwnerEmployeeId: null });
    expect(calls[1].input).toEqual({ accountId: "acct_1", ownerEmployeeId: "e-1", expectedCurrentOwnerEmployeeId: null, ownershipHandoff: { reason: "remediation" } });
  });

  it("updateAccount: clearing an existing owner is refused OWNER_REQUIRED before anything is sent", async () => {
    await expect(accounts.updateAccount("acct_1", { name: "X", accountOwner: null, ownershipChange: { previousOwnerEmployeeId: "e-1" } }))
      .rejects.toMatchObject({ code: "OWNER_REQUIRED", status: 400 });
    expect(calls).toEqual([]);
    expect(firestoreCalls).toEqual([]);
  });

  it("updateAccount: no pre-read -- an owner named without the edit's starting owner is refused, nothing sent", async () => {
    await expect(accounts.updateAccount("acct_1", { accountOwner: { assignedToEmployeeId: "e-1" } }))
      .rejects.toMatchObject({ code: "OWNER_CHANGE_UNSTATED", status: 400 });
    expect(calls).toEqual([]);
  });

  it("updateAccount: 412 ACCOUNT_OWNER_CHANGED_SINCE_READ is thrown as refused, stated plainly, and never retried", async () => {
    reply = () => ({ ok: false, status: 412, code: "ACCOUNT_OWNER_CHANGED_SINCE_READ", message: "the Account's owner changed since it was read; re-read the Account and decide again" });
    const err = await accounts.updateAccount("acct_1", { name: "X", accountOwner: { assignedToEmployeeId: "e-2" }, ownershipChange: { previousOwnerEmployeeId: "e-1" } }).catch((e) => e);
    expect(err).toMatchObject({ code: "ACCOUNT_OWNER_CHANGED_SINCE_READ", status: 412 });
    expect(calls.map((c) => c.operation)).toEqual(["updateAccount"]);
    expect(calls[0].input).toMatchObject({ ownerEmployeeId: "e-2", expectedCurrentOwnerEmployeeId: "e-1" });
    expect(crmRefusalMessage(err)).toBe("Nothing was saved: this customer's owner changed after you opened it. The customer has been re-read -- review the owner and save again.");
    expect(firestoreCalls).toEqual([]);
  });

  it("updateAccount: a server refusal is thrown with its exact code and status", async () => {
    reply = () => ({ ok: false, status: 400, code: "INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED", message: "this Account has no owner" });
    await expect(accounts.updateAccount("acct_1", { accountOwner: { assignedToEmployeeId: "e-2" }, ownershipChange: { previousOwnerEmployeeId: "e-1" } }))
      .rejects.toMatchObject({ code: "INITIAL_OWNER_ASSIGNMENT_SOURCE_NOT_ALLOWED", status: 400 });
  });

  it("contacts, customer sites and CSV import go through the CRM route with server provenance", async () => {
    reply = (op, input) => ({ ok: true, result: op.includes("Location")
      ? { accountLocationId: "site_1", accountId: "acct_1", name: input.name ?? "S", addressStreet: input.addressStreet ?? null, createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z" }
      : { contactId: "cont_1", accountId: "acct_1", name: input.name ?? "C", contactRole: input.contactRole ?? null, createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z" } });
    await contacts.createContact("acct_1", { name: "Ada", role: "Buyer", createdBy: "forged", createdAt: 1 });
    await contacts.updateContact("cont_1", { phone: "555", createdBy: "forged" });
    await locations.createLocation("acct_1", { name: "Main", address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" }, accessNotes: null });
    await locations.updateLocation("site_1", { accessNotes: "Dock" });
    expect(calls.map((c) => c.operation)).toEqual(["createContact", "updateContact", "createAccountLocation", "updateAccountLocation"]);
    expect(calls[0].input).toMatchObject({ accountId: "acct_1", name: "Ada", contactRole: "Buyer" });
    expect(calls[1].input).toEqual({ contactId: "cont_1", phone: "555" });
    expect(calls[2].input).toMatchObject({ accountId: "acct_1", name: "Main", addressStreet: "1 Main", addressCity: "Austin", addressState: "TX", addressPostalCode: "78701" });
    for (const c of calls) for (const f of ["createdBy", "createdAt", "updatedBy", "updatedAt"]) expect(c.input).not.toHaveProperty(f);
    expect(firestoreCalls).toEqual([]);
  });
});

describe("the Customers list source serves only what PostgreSQL serves", () => {
  it("name order + status filter map to listAccounts; anything else refuses instead of widening", async () => {
    reply = () => ({ ok: true, result: { items: [ACCOUNT], truncated: true, nextCursor: "c2" } });
    const page = await crmList.fetchPage({ pageSize: 50, filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }], sort: [{ fieldId: "name", direction: "ASC" }, { fieldId: "__name__", direction: "ASC" }] });
    expect(calls[0].input).toEqual({ limit: 50, status: "ACTIVE" });
    expect(page).toMatchObject({ hasMore: true, nextCursorDoc: "c2" });
    expect(page.rows[0].id).toBe("acct_1");
    await expect(crmList.fetchPage({ pageSize: 50, filters: [], sort: [{ fieldId: "updatedAt", direction: "DESC" }] })).rejects.toThrow(/not served/);
    await expect(crmList.fetchPage({ pageSize: 50, filters: [{ fieldId: "tags", operator: "ARRAY_CONTAINS", value: "VIP" }], sort: [] })).rejects.toThrow(/not served/);
  });
});

describe("reads use the CRM route only, and a failed read never falls back to Firestore", () => {
  it("useLocation: a denied read is a safe error, a confirmed absence is null, and Firestore is never touched", async () => {
    reply = () => ({ ok: false, code: "CAPABILITY_REQUIRED", message: "this read requires customer.record.read" });
    const denied = renderHook(() => useLocation("loc-1"));
    expect(denied.result.current.loading).toBe(true);
    await waitFor(() => expect(denied.result.current.loading).toBe(false));
    expect(denied.result.current.error).toBe("You do not have permission to view these locations.");
    expect(denied.result.current.location).toBe(null);
    cleanup();

    reply = () => ({ ok: false, code: "ACCOUNT_LOCATION_NOT_FOUND", message: "no such site" });
    const absent = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(absent.result.current.loading).toBe(false));
    expect(absent.result.current.error).toBe(null);
    expect(absent.result.current.location).toBe(null);
    cleanup();
    expect(calls.map((c) => c.operation)).toEqual(["getAccountLocation", "getAccountLocation"]);
    expect(firestoreCalls).toEqual([]);
  });

  it("useAccountNamesWithStatus: names come from getAccount; a refusal is DENIED with no Firestore retry", async () => {
    reply = (op, input) => (input.accountId === "missing"
      ? { ok: false, code: "ACCOUNT_NOT_FOUND", message: "no such account" }
      : { ok: true, result: { ...ACCOUNT, accountId: input.accountId, name: `Name ${input.accountId}` } });
    const ok = renderHook(() => useAccountNamesWithStatus(["a1", "missing"]));
    await waitFor(() => expect(ok.result.current.status).toBe(ACCOUNT_NAMES_STATUS.READY));
    expect([...ok.result.current.names]).toEqual([["a1", "Name a1"]]);
    cleanup();

    reply = () => ({ ok: false, code: "FORBIDDEN", message: "no" });
    const denied = renderHook(() => useAccountNamesWithStatus(["a2"]));
    await waitFor(() => expect(denied.result.current.status).toBe(ACCOUNT_NAMES_STATUS.DENIED));
    expect(denied.result.current.names.size).toBe(0);
    cleanup();
    expect(firestoreCalls).toEqual([]);
  });

  it("an unreachable EOS API is a failure, never a Firestore read", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("offline"); };
    try {
      const { result } = renderHook(() => useLocation("loc-9"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toMatch(/Can't reach the server/);
      cleanup();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(firestoreCalls).toEqual([]);
  });
});

describe("the platform-sandbox Customers list and owner identity", () => {
  it("the Account entity is served by the EOS API with name order and a status filter only, and is still valid", () => {
    expect(accountEntity.readVia).toBe("EOS_API");
    expect(accountIndexList.filters.map((f) => f.fieldId)).toEqual(["status"]);
    expect(accountIndexList.defaultSort.map((s) => [s.fieldId, s.direction])).toEqual([["name", "ASC"]]);
    expect(accountIndexList.columns.filter((c) => c.sortable).map((c) => c.fieldId)).toEqual(["name"]);
    expect(validateEntityDefinition(accountEntity)).toEqual([]);
    expect(validateListViewDefinition(accountIndexList, accountEntity)).toEqual([]);
  });

  it("a PostgreSQL CRM owner (Employee id, no userId) is complete and resolves through byEmployeeId", () => {
    const owner = { assignedToEmployeeId: "e-1", source: "EOS_CRM" };
    expect(isCompleteAccountOwner(owner)).toBe(true);
    const byEmployeeId = new Map([["e-1", { displayName: "Ada Lovelace" }]]);
    expect(resolveOwnerIdentity(owner, { byUserId: new Map(), byEmployeeId })).toEqual({ state: "resolved", name: "Ada Lovelace" });
  });
});

describe("the EOS path modules carry no Firestore dependency", () => {
  it("the EOS API implementations, list source and client import no Firestore SDK and name no CRM collection", () => {
    const src = join(import.meta.dirname, "..", "src");
    const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
    const files = [...walk(join(src, "domain", "crm", "eosApi")), ...walk(join(src, "hooks", "crm", "eosApi")),
      join(src, "metadata", "crmListSource.js"), join(src, "services", "crmApiClient.js")];
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const f of files) {
      const code = readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/firebase\/firestore|firebase\/functions|collectionStore|CONTACTS_COLLECTION|writeBatch|addDoc|updateDoc|setDoc|onSnapshot|getDocs|httpsCallable|crmCutoverFreeze/);
    }
  });
});

describe("Contact CSV import is ONE atomic importAccountContacts call", () => {
  const imported = (n) => ({ ok: true, result: { accountId: "acct_1", importedCount: n, contacts: Array.from({ length: n }, (_, i) => ({ contactId: `cont_${i + 1}` })) } });

  it("all rows go in one call, never primary, under the caller's idempotency key", async () => {
    reply = () => imported(2);
    const result = await importContacts("acct_1", [{ name: "A" }, { name: "B", role: "Chef", email: "b@x.test" }], { idempotencyKey: "intent-1" });
    expect(calls.map((c) => c.operation)).toEqual(["importAccountContacts"]);
    expect(calls[0].input).toEqual({
      idempotencyKey: "intent-1",
      accountId: "acct_1",
      contacts: [
        { name: "A", phone: null, email: null, contactRole: null, isPrimary: false },
        { name: "B", phone: null, email: "b@x.test", contactRole: "Chef", isPrimary: false },
      ],
    });
    expect(result.ids).toEqual(["cont_1", "cont_2"]);
    expect(firestoreCalls).toEqual([]);
  });

  it("a refusal says nothing was imported and carries the server's per-row findings", async () => {
    reply = () => ({ ok: false, status: 400, code: "IMPORT_ROWS_INVALID", message: "1 of 2 rows were refused, so nothing was imported: 1 (FIELD_INVALID)", findings: [{ index: 1, code: "FIELD_INVALID", message: "email must be an email address" }] });
    const err = await importContacts("acct_1", [{ name: "A" }, { name: "B" }], { idempotencyKey: "intent-2" }).catch((e) => e);
    expect(err).toMatchObject({ code: "IMPORT_ROWS_INVALID", status: 400, nothingImported: true });
    expect(err.findings).toEqual([{ index: 1, code: "FIELD_INVALID", message: "email must be an email address" }]);
    expect(calls).toHaveLength(1);
  });

  it("the 200-row bound is enforced before sending, matching the server", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ name: `N${i}` }));
    await expect(importContacts("acct_1", rows)).rejects.toMatchObject({ code: "IMPORT_SIZE_INVALID", nothingImported: true });
    await expect(importContacts("acct_1", [])).rejects.toMatchObject({ code: "IMPORT_SIZE_INVALID" });
    expect(calls).toEqual([]);
    expect(typeof newContactImportKey()).toBe("string");
    expect(newContactImportKey()).not.toBe(newContactImportKey());
  });
});

describe("platform-sandbox Account form: owner handoff vs initial assignment", () => {
  const OWNED = { name: "Mesquite", status: "ACTIVE", accountOwner: { assignedToEmployeeId: "e-1", source: "EOS_CRM" } };
  const OWNERLESS = { name: "Mesquite", status: "ACTIVE", accountOwner: null };

  function renderForm(initialValues, onSubmit = vi.fn(async () => {})) {
    render(<AccountForm initialValues={initialValues} onSubmit={onSubmit} onCancel={() => {}} submitLabel="Save" contacts={[]} />);
    return onSubmit;
  }

  it("an owned customer: no Clear owner; choosing another owner asks for a handoff source (three, default Direct handoff) and reason", async () => {
    const onSubmit = renderForm(OWNED);
    expect(screen.queryByRole("button", { name: "Clear owner" })).toBeNull();
    expect(screen.getByText(/The owner cannot be cleared/)).toBeTruthy();
    expect(screen.queryByLabelText(/Handoff source/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pick Bea" }));
    const source = screen.getByLabelText(/Handoff source/);
    expect([...source.querySelectorAll("option")].map((o) => o.value)).toEqual(["DIRECT_HANDOFF", "CUSTOMER_HANDOFF_REVIEW", "ADMIN_CORRECTION"]);
    expect(source.value).toBe("DIRECT_HANDOFF");
    fireEvent.change(source, { target: { value: "ADMIN_CORRECTION" } });
    fireEvent.change(screen.getByLabelText(/Handoff reason/), { target: { value: "wrong rep" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      accountOwner: { assignedToEmployeeId: "e-2" },
      ownershipChange: { previousOwnerEmployeeId: "e-1", source: "ADMIN_CORRECTION", reason: "wrong rep" },
    });
  });

  it("an owned customer whose selection is cleared is refused in the form and nothing is submitted", async () => {
    const onSubmit = renderForm(OWNED);
    fireEvent.click(screen.getByRole("button", { name: "Unpick" }));
    expect(screen.getByText(/An owner is required. Choose another owner/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("an ownerless customer: picking an owner is a first assignment -- no source control, optional reason", async () => {
    const onSubmit = renderForm(OWNERLESS);
    fireEvent.click(screen.getByRole("button", { name: "Pick Bea" }));
    expect(screen.queryByLabelText(/Handoff source/)).toBeNull();
    expect(screen.getByText(/first owner assignment/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Assignment reason/), { target: { value: "remediation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    reply = () => ({ ok: true, result: ACCOUNT });
    await accounts.updateAccount("acct_1", onSubmit.mock.calls[0][0]);
    expect(calls.at(-1).operation).toBe("updateAccount");
    expect(calls.at(-1).input).toMatchObject({ ownerEmployeeId: "e-2", expectedCurrentOwnerEmployeeId: null, ownershipHandoff: { reason: "remediation" } });
    expect(calls.at(-1).input.ownershipHandoff).not.toHaveProperty("source");
    expect(firestoreCalls).toEqual([]);
  });

  it("a refused save states the refusal exactly (status kind, server message, code)", async () => {
    renderForm(OWNED, async () => {
      throw Object.assign(new Error("this command requires customer.record.update"), { code: "CAPABILITY_REQUIRED", status: 403 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You do not have permission to do this. This command requires customer.record.update (CAPABILITY_REQUIRED)."))
      .toBeTruthy();
  });
});

describe("platform-sandbox Contact import modal: all or nothing, findings by row, one key per intent", () => {
  async function toPreview() {
    const onImported = vi.fn();
    render(<ContactImportModal accountId="acct_1" accountName="Mesquite" existingContacts={[]} onClose={() => {}} onImported={onImported} />);
    const csv = "Name,Email\nAda,ada@x.test\nBea,bea@x.test\n";
    const file = new File([csv], "contacts.csv", { type: "text/csv" });
    file.text = async () => csv; // jsdom's File has no text()
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    fireEvent.click(await screen.findByRole("button", { name: "Validate" }));
    return onImported;
  }

  it("a refusal says NOTHING was imported, lists findings by CSV row, and a retry reuses the same idempotency key", async () => {
    const onImported = await toPreview();
    reply = () => ({ ok: false, status: 400, code: "IMPORT_ROWS_INVALID", message: "1 of 2 rows were refused, so nothing was imported: 1 (FIELD_INVALID)",
      findings: [{ index: 1, code: "FIELD_INVALID", message: "email is not accepted" }] });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 contacts" }));
    const alert = await screen.findByText(/^Nothing was imported\./);
    expect(alert.textContent).toContain("(IMPORT_ROWS_INVALID)");
    expect(within(alert).getByText("Row 2: email is not accepted (FIELD_INVALID)")).toBeTruthy();
    expect(screen.queryByText(/imported before/i)).toBeNull();

    reply = () => ({ ok: true, result: { accountId: "acct_1", importedCount: 2, contacts: [{ contactId: "c1" }, { contactId: "c2" }] } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 contacts" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(calls.map((c) => c.operation)).toEqual(["importAccountContacts", "importAccountContacts"]);
    expect(calls[1].input.idempotencyKey).toBe(calls[0].input.idempotencyKey);
    expect(onImported.mock.calls[0][0]).toMatchObject({ importedIds: ["c1", "c2"], importedCount: 2 });
    expect(firestoreCalls).toEqual([]);
  });

  it("re-validating the preview is a new import intent with a new key", async () => {
    await toPreview();
    reply = () => ({ ok: false, status: 503, code: "POSTGRES_CRM_WRITER_INACTIVE", message: "the PostgreSQL CRM authority is not active yet" });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 contacts" }));
    await screen.findByText(/^Nothing was imported\. Customer records are not available right now\./);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Validate" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 contacts" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].input.idempotencyKey).not.toBe(calls[0].input.idempotencyKey);
  });
});

describe("platform-sandbox ownership history beside the owner fact", () => {
  it("reads listAccountOwnershipHistory, names owners from the directory (never raw ids), and re-reads on refresh", async () => {
    reply = () => ({ ok: true, result: { truncated: false, nextCursor: null, items: [
      { historyId: "h2", accountId: "acct_1", event: "OWNER_HANDOFF", previousOwnerEmployeeId: "e-1", newOwnerEmployeeId: "e-2", source: "CUSTOMER_HANDOFF_REVIEW", reason: "territory", effectiveAt: "2026-09-16T10:00:00.000Z" },
      { historyId: "h1", accountId: "acct_1", event: "INITIAL_OWNER_ASSIGNMENT", previousOwnerEmployeeId: null, newOwnerEmployeeId: "e-1", source: null, reason: null, effectiveAt: "2026-09-15T10:00:00.000Z" },
    ] } });
    const byEmployeeId = new Map([["e-1", { displayName: "Ada One" }], ["e-2", { displayName: "Bea Two" }]]);
    const view = render(<AccountOwnershipHistorySection accountId="acct_1" refreshKey={0} byEmployeeId={byEmployeeId} />);
    const section = await screen.findByRole("region", { name: "Ownership history" });
    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(2));
    const [latest, first] = within(section).getAllByRole("listitem").map((li) => li.textContent);
    expect(latest).toMatch(/Owner handoff from Ada One to Bea Two \(Customer handoff review\)\. territory$/);
    expect(first).toMatch(/First owner assigned to Ada One$/);
    expect(section.textContent).not.toMatch(/e-1|e-2/);
    expect(calls[0]).toMatchObject({ operation: "listAccountOwnershipHistory", input: { accountId: "acct_1", limit: 10 } });

    view.rerender(<AccountOwnershipHistorySection accountId="acct_1" refreshKey={1} byEmployeeId={byEmployeeId} />);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(firestoreCalls).toEqual([]);
  });

  it("a refused history read is an honest unavailable state with a retry, not an empty history", async () => {
    reply = () => ({ ok: false, status: 403, code: "CAPABILITY_REQUIRED", message: "no" });
    render(<AccountOwnershipHistorySection accountId="acct_1" byEmployeeId={new Map()} />);
    expect(await screen.findByText(/You do not have permission to view these ownership records\./)).toBeTruthy();
    expect(screen.queryByText("No ownership changes recorded.")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
