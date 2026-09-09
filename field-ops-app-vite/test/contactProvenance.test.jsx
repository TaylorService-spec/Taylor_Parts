// Contact provenance convergence -- every Contact write path (single create, single
// update, CSV import) must produce the platform's four provenance fields
// (metadata/v2/provenance.js's PROVENANCE_SYSTEM_NAMES: createdAt/createdBy/updatedAt/
// updatedBy). ALL THREE now go through trusted commands, so none of them is a CLIENT-SUPPLIED
// CLAIM any more: the server resolves the actor from request.auth.uid, stamps its own clock, and
// strips those four keys from any payload that carries them. That the fields ARE written correctly
// is asserted server-side (functions/test/crmWriteCommands.test.mjs,
// functions/test/contactImportCommand.test.mjs).
//
// What is asserted HERE is the client half, and it is the inverse of what this file used to check:
// that the browser sends no actor and no timestamp at all.
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
    if (name === "importContacts") return { data: { ids: (payload.contacts ?? []).map((_, i) => `imported-${i}`) } };
    // The two single-record commands echo the written document back.
    return { data: { id: "new-id", ...(payload.data ?? {}) } };
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

describe("createContact / updateContact -- the browser no longer authors provenance", () => {
  // INVERTED, exactly as the import block below already was, and for the same reason: the behaviour
  // MOVED rather than changed. Both single-record paths now go through trusted commands
  // (functions/src/crm/crmWriteCommands.ts), which resolve the actor from request.auth.uid, stamp
  // the server clock, and STRIP createdAt/createdBy/updatedAt/updatedBy from any payload that
  // carries them. That the four fields are written, and written correctly, is asserted server-side
  // in functions/test/crmWriteCommands.test.mjs.
  //
  // The null-actor fallback is GONE, and that is the improvement rather than a regression: an
  // unauthenticated caller is refused outright, so no contact can be created with createdBy null.
  //
  // What is worth pinning HERE is the client-side half: this module sends nothing about who is
  // acting or when. Asserting the old behaviour would require the browser to keep authoring an
  // identity the server ignores.
  it("createContact sends the account and the row, and no provenance of any kind", async () => {
    await createContact("account-1", { name: "Ada" });
    expect(callableCalls.length).toBe(1);
    const [name, payload] = callableCalls[0];
    expect(name).toBe("createContactRecord");
    expect(payload.accountId).toBe("account-1");
    expect(payload.data.name).toBe("Ada");
    const sent = JSON.stringify(payload);
    for (const field of [...PROVENANCE_SYSTEM_NAMES, "actorUid", "uid"]) {
      expect(sent).not.toContain(field);
    }
  });

  it("updateContact sends the id and the patch, and no provenance of any kind", async () => {
    await updateContact("contact-1", { name: "Ada Lovelace" });
    expect(callableCalls.length).toBe(1);
    const [name, payload] = callableCalls[0];
    expect(name).toBe("updateContactRecord");
    expect(payload.id).toBe("contact-1");
    const sent = JSON.stringify(payload);
    for (const field of PROVENANCE_SYSTEM_NAMES) {
      expect(sent).not.toContain(field);
    }
  });

  it("a caller-supplied createdAt/createdBy is sent but CANNOT take effect", async () => {
    // The client does not strip them -- it has no reason to know they are special. The SERVER
    // strips them, which is the only place that guarantee can live. This pins that the client makes
    // no claim about it either way, so the server-side test is the single source of that truth.
    await updateContact("contact-1", { name: "Ada", createdAt: 1, createdBy: "someone-else" });
    const [, payload] = callableCalls[0];
    expect(payload.data.createdAt).toBe(1);
    expect(payload.data.createdBy).toBe("someone-else");
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
