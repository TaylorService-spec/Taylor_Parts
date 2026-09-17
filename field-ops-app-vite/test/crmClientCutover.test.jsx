// CRM CUTOVER (client), PLATFORM-SANDBOX BUILD: Account / Contact / customer-site business reads and writes go ONLY
// to the EOS API (POST /crm/customer, governed PostgreSQL CRM). Provenance is the SERVER's; no Firestore write, no
// fallback.
//
// This suite runs the app's PUBLIC CRM modules as a platform-sandbox build selects them. The routed modules read the
// build-time define `__APP_CRM_VIA_EOS_API__` (see src/domain/crmAuthorityRoute.js); vitest.config.js deliberately
// does not define it, so every other suite exercises the legacy Firestore path exactly as before. Here it is set to
// `true` on globalThis BEFORE any CRM module is imported -- the same boolean vite.config.js bakes into a
// platform-sandbox bundle -- and every CRM module below is imported dynamically after that.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

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
  return { status: res.ok ? 200 : 400, json: async () => res };
};
import.meta.env.VITE_EOS_API_BASE_URL = "https://eos-api.example";

const accounts = await import("../src/domain/accounts.js");
const contacts = await import("../src/domain/contacts.js");
const locations = await import("../src/domain/locations.js");
const { importContacts } = await import("../src/domain/contactImport.js");
const crmList = await import("../src/metadata/crmListSource.js");
const { useLocation } = await import("../src/hooks/useLocation.js");
const { useAccountNamesWithStatus, ACCOUNT_NAMES_STATUS } = await import("../src/hooks/useAccountNames.js");
const { accountEntity, accountIndexList } = await import("../src/metadata/definitions/account.js");
const { validateEntityDefinition } = await import("../src/metadata/entityDefinition.js");
const { validateListViewDefinition } = await import("../src/metadata/listViewDefinition.js");
const { resolveOwnerIdentity, isCompleteAccountOwner } = await import("../src/domain/commercialProfile.js");

const ACCOUNT = { accountId: "acct_1", name: "Mesquite", status: "ACTIVE", ownerEmployeeId: "e-1", tags: [], relationshipTypes: [], lineOfBusiness: [], createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z", createdBy: "p-1", updatedBy: "p-1" };

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

  it("updateAccount refuses an owner change (ACCOUNT_OWNER_HANDOFF_PENDING) and otherwise sends only governed fields", async () => {
    reply = (op) => ({ ok: true, result: ACCOUNT });
    await expect(accounts.updateAccount("acct_1", { name: "X", accountOwner: { assignedToEmployeeId: "e-2" } })).rejects.toMatchObject({ code: "ACCOUNT_OWNER_HANDOFF_PENDING" });
    expect(calls.map((c) => c.operation)).toEqual(["getAccount"]);
    calls.length = 0;
    await accounts.updateAccount("acct_1", { name: "X", accountOwner: { assignedToEmployeeId: "e-1", source: "EOS_CRM" }, billingContact: { contactId: "cont_1" } });
    expect(calls.map((c) => c.operation)).toEqual(["getAccount", "updateAccount"]);
    expect(calls[1].input).toEqual({ accountId: "acct_1", name: "X", billingContactId: "cont_1" });
  });

  it("contacts, customer sites and CSV import go through the CRM route with server provenance", async () => {
    reply = (op, input) => ({ ok: true, result: op.includes("Location")
      ? { accountLocationId: "site_1", accountId: "acct_1", name: input.name ?? "S", addressStreet: input.addressStreet ?? null, createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z" }
      : { contactId: "cont_1", accountId: "acct_1", name: input.name ?? "C", contactRole: input.contactRole ?? null, createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:00:00Z" } });
    await contacts.createContact("acct_1", { name: "Ada", role: "Buyer", createdBy: "forged", createdAt: 1 });
    await contacts.updateContact("cont_1", { phone: "555", createdBy: "forged" });
    await locations.createLocation("acct_1", { name: "Main", address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" }, accessNotes: null });
    await locations.updateLocation("site_1", { accessNotes: "Dock" });
    const imported = await importContacts("acct_1", [{ name: "A" }, { name: "B", role: "Chef" }]);
    expect(calls.map((c) => c.operation)).toEqual(["createContact", "updateContact", "createAccountLocation", "updateAccountLocation", "createContact", "createContact"]);
    expect(calls[0].input).toMatchObject({ accountId: "acct_1", name: "Ada", contactRole: "Buyer" });
    expect(calls[1].input).toEqual({ contactId: "cont_1", phone: "555" });
    expect(calls[2].input).toMatchObject({ accountId: "acct_1", name: "Main", addressStreet: "1 Main", addressCity: "Austin", addressState: "TX", addressPostalCode: "78701" });
    expect(imported.ids).toEqual(["cont_1", "cont_1"]);
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
