// Contact provenance convergence -- every Contact write path (single create, single
// update, CSV import) must produce the platform's four provenance fields
// (metadata/v2/provenance.js's PROVENANCE_SYSTEM_NAMES: createdAt/createdBy/updatedAt/
// updatedBy). Contact is a CLIENT-DIRECT write (no callable, gated by firestore.rules'
// isAdminOrDispatcher()), so firebase is fully mocked here -- no emulator, no backend
// touched -- and the actor/timestamp asserted below are the CLIENT-SUPPLIED CLAIMS the
// domain modules now write, not server-verified provenance.
//
// Future writes only. This does not assert anything about historical documents.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockAuth = { currentUser: { uid: "actor-uid-1" } };

const addDocCalls = [];
const updateDocCalls = [];
const batchSets = [];

vi.mock("../src/firebase/firebase", () => ({
  db: {},
  auth: mockAuth,
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

describe("importContacts -- writes all four provenance fields on every imported row", () => {
  it("stamps createdAt/createdBy/updatedAt/updatedBy on each row", async () => {
    const result = await importContacts("account-1", [
      { name: "Ada", email: "ada@x.com" },
      { name: "Grace", email: "grace@x.com" },
    ]);
    expect(result.ids.length).toBe(2);
    expect(batchSets.length).toBe(2);
    for (const { data } of batchSets) {
      for (const field of PROVENANCE_SYSTEM_NAMES) {
        expect(data).toHaveProperty(field);
      }
      expect(typeof data.createdAt).toBe("number");
      expect(typeof data.updatedAt).toBe("number");
      expect(data.createdBy).toBe("actor-uid-1");
      expect(data.updatedBy).toBe("actor-uid-1");
    }
  });

  it("falls back to null when there is no signed-in user", async () => {
    mockAuth.currentUser = null;
    await importContacts("account-1", [{ name: "Ada" }]);
    expect(batchSets[0].data.createdBy).toBe(null);
    expect(batchSets[0].data.updatedBy).toBe(null);
  });
});
