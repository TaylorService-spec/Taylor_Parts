// CRM CUTOVER (client): Account / Contact / customer-site business reads and writes go ONLY to the EOS API
// (POST /crm/customer, governed PostgreSQL CRM). Provenance is the SERVER's; no Firestore write, no fallback.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const mockAuth = { currentUser: { uid: "firebase-uid-1", getIdToken: async () => "id-token" } };
vi.mock("../src/firebase/firebase", () => ({ db: {}, auth: mockAuth }));
vi.mock("../src/firebase/firebase.js", () => ({ db: {}, auth: mockAuth }));
const firestoreCalls = [];
vi.mock("firebase/firestore", () => new Proxy({}, { get: (_t, name) => (...args) => { firestoreCalls.push(name); return undefined; } }));

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

describe("no migrated CRM module writes or reads Firestore", () => {
  it("the cut-over writers, hooks and list source import no Firestore SDK and name no CRM collection", () => {
    const src = join(import.meta.dirname, "..", "src");
    const files = ["domain/accounts.js", "domain/contacts.js", "domain/locations.js", "domain/contactImport.js", "hooks/useAccount.js",
      "hooks/useAccountPicker.js", "hooks/useAccountSearch.js", "hooks/useContactsForAccount.js", "hooks/useLocationsForAccount.js",
      "hooks/useLocation.js", "metadata/crmListSource.js", "services/crmApiClient.js"];
    for (const f of files) {
      const code = readFileSync(join(src, f), "utf8").replace(/\/\/[^\n]*/g, "");
      expect(code, f).not.toMatch(/firebase\/firestore|collectionStore|ACCOUNTS_COLLECTION|CONTACTS_COLLECTION|LOCATIONS_COLLECTION|writeBatch|addDoc|updateDoc|onSnapshot/);
    }
    // Nothing in the client still imports the retired Firestore CRM stores.
    const walk = (d) => readdirSync(d).flatMap((e) => (statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)]));
    const offenders = walk(src).filter((f) => /\.(js|jsx|ts|tsx)$/.test(f) && /accountsStore|contactsStore|locationsStore/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
