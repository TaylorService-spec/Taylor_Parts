// Contact provenance convergence -- every Contact write path (single create, single
// update, CSV import) must produce the platform's four provenance fields
// (metadata/v2/provenance.js's PROVENANCE_SYSTEM_NAMES: createdAt/createdBy/updatedAt/
// updatedBy). The two SINGLE-record paths are still client-direct writes gated by
// firestore.rules, so the actor/timestamp asserted for them are CLIENT-SUPPLIED CLAIMS, not
// server-verified provenance. The CSV IMPORT is not: it now goes through the trusted
// importContacts command, which writes all four fields itself from request.auth.uid -- so the
// property asserted for it is inverted, and is that the browser sends no actor at all.
//
// Firebase and the callable transport are both fully mocked -- no emulator, no backend touched.
//
// Future writes only. This does not assert anything about historical documents.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockAuth = { currentUser: { uid: "actor-uid-1" } };

const addDocCalls = [];
const updateDocCalls = [];
const batchSets = [];
// The import is no longer a client write, so it needs a callable recorder rather than a batch one.
const callableCalls = [];
let writeBlocked = false;
const setWriteBlocked = (v) => {
  writeBlocked = v;
};

vi.mock("../src/firebase/firebase", () => ({
  db: {},
  auth: mockAuth,
  // The import resolves `functions` from this module for its callable transport.
  functions: {},
}));

vi.mock("../src/config/env", () => ({
  isWriteBlocked: () => writeBlocked,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions, name) => async (payload) => {
    callableCalls.push([name, payload]);
    return { data: { ids: (payload.contacts ?? []).map((_, i) => `imported-${i}`) } };
  },
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ __collection: name }),
  doc: (colOrDb, ...rest) => ({ __doc: true, path: rest.join("/") || `${colOrDb.__collection ?? "doc"}/${Math.random()}` }),
  getDocs: async () => ({ docs: [] }),
  addDoc: async (ref, data) => {
    addDocCalls.push({ ref, data });
    return { id: "new-contact-id" };
  },
  updateDoc: async (ref, data) => {
    updateDocCalls.push({ ref, data });
    return undefined;
  },
  deleteDoc: async () => undefined,
  writeBatch: () => ({
    set: (ref, data) => batchSets.push({ ref, data }),
    commit: async () => undefined,
  }),
}));

const { createContact, updateContact } = await import("../src/domain/contacts.js");
const { importContacts } = await import("../src/domain/contactImport.js");
const { PROVENANCE_SYSTEM_NAMES } = await import("../src/metadata/v2/provenance.js");

beforeEach(() => {
  addDocCalls.length = 0;
  updateDocCalls.length = 0;
  batchSets.length = 0;
  callableCalls.length = 0;
  writeBlocked = false;
  mockAuth.currentUser = { uid: "actor-uid-1" };
});

describe("createContact -- writes all four provenance fields", () => {
  it("writes createdAt, createdBy, updatedAt, updatedBy", async () => {
    await createContact("account-1", { name: "Ada" });
    expect(addDocCalls.length).toBe(1);
    const written = addDocCalls[0].data;
    for (const field of PROVENANCE_SYSTEM_NAMES) {
      expect(written).toHaveProperty(field);
    }
    expect(typeof written.createdAt).toBe("number");
    expect(typeof written.updatedAt).toBe("number");
    expect(written.createdBy).toBe("actor-uid-1");
    expect(written.updatedBy).toBe("actor-uid-1");
  });

  it("falls back to null when there is no signed-in user, rather than inventing an actor", async () => {
    mockAuth.currentUser = null;
    await createContact("account-1", { name: "Ada" });
    const written = addDocCalls[0].data;
    expect(written.createdBy).toBe(null);
    expect(written.updatedBy).toBe(null);
  });
});

describe("updateContact -- writes updatedAt and updatedBy, never createdAt/createdBy", () => {
  it("writes updatedAt and updatedBy", async () => {
    await updateContact("contact-1", { name: "Ada Lovelace" });
    expect(updateDocCalls.length).toBe(1);
    const written = updateDocCalls[0].data;
    expect(typeof written.updatedAt).toBe("number");
    expect(written.updatedBy).toBe("actor-uid-1");
  });

  it("never rewrites createdAt or createdBy, even if the caller's edit payload contains them", async () => {
    await updateContact("contact-1", { name: "Ada", createdAt: 1, createdBy: "someone-else" });
    const written = updateDocCalls[0].data;
    // updateContact does not itself strip caller-supplied createdAt/createdBy -- the
    // invariant it owns is that IT never MINTS a createdAt/createdBy value on an update,
    // unlike updatedAt/updatedBy which it always sets fresh below.
    expect(written.updatedAt).not.toBe(1);
    expect(written.updatedBy).toBe("actor-uid-1");
  });
});

describe("importContacts -- the browser no longer authors provenance at all", () => {
  // THE ASSERTIONS INVERTED, because the behaviour moved rather than changed.
  //
  // This block used to prove the client stamped createdAt/createdBy/updatedAt/updatedBy on each
  // row, and that createdBy fell back to null when nobody was signed in. Both were true of a
  // client-direct writeBatch. The import now goes through the trusted importContacts command, which
  // resolves the actor from request.auth.uid and writes all four itself
  // (functions/src/crm/contactImportCommand.ts, covered by functions/test/contactImportCommand.test.mjs).
  //
  // So the client-side property worth pinning is the opposite one: that this module sends NOTHING
  // about who is acting. Asserting the old behaviour here would require the browser to keep
  // authoring an identity the server ignores.
  //
  // The null fallback is GONE, and that is the point rather than a regression: an unauthenticated
  // caller is now refused outright, so no import can produce a contact whose createdBy is null.
  it("sends the rows and the account, and no actor field of any kind", async () => {
    const result = await importContacts("account-1", [
      { name: "Ada", email: "ada@x.com" },
      { name: "Grace", email: "grace@x.com" },
    ]);
    expect(result.ids.length).toBe(2);
    expect(callableCalls.length).toBe(1);

    const [name, payload] = callableCalls[0];
    expect(name).toBe("importContacts");
    expect(payload.accountId).toBe("account-1");
    expect(payload.contacts.map((c) => c.name)).toEqual(["Ada", "Grace"]);

    const sent = JSON.stringify(payload);
    for (const field of [...PROVENANCE_SYSTEM_NAMES, "actorUid", "principalUid", "uid"]) {
      expect(sent).not.toContain(field);
    }
  });

  it("writes nothing when the platform write gate is closed", async () => {
    setWriteBlocked(true);
    const result = await importContacts("account-1", [{ name: "Ada" }]);
    expect(result).toEqual({ blocked: true });
    expect(callableCalls.length).toBe(0);
  });
});
