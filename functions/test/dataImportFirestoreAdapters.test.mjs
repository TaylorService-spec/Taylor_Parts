// EOS Data Import P1 -- the FIRESTORE adapters, against fakes.
//
// These are the only import modules that know a collection name, so they are the only ones
// whose storage behaviour is worth asserting. No emulator: every function takes its
// Firestore as an argument, which is what makes a fake sufficient here and a real database
// unnecessary.
import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_JOBS_COLLECTION,
  loadExistingPartIdentities,
  firestoreImportJobStore,
  toGovernedPartInput,
} from "../lib/dataImport/firestoreDataImportAdapters.js";
import { derivePartId } from "../lib/dataImport/contracts/partImportContract.js";

/**
 * Minimal Firestore stand-in: `docs` is a flat map of "collection/id" -> data. Only the
 * surface these adapters actually use is implemented, so an adapter that reached for
 * anything else would fail loudly rather than silently pass against a permissive mock.
 */
function fakeDb(docs = {}) {
  const store = new Map(Object.entries(docs));
  const collection = (name) => ({
    doc: (id) => ({
      __path: `${name}/${id}`,
      async get() {
        const key = `${name}/${id}`;
        return { exists: store.has(key), data: () => store.get(key) };
      },
      async set(value) {
        store.set(`${name}/${id}`, value);
      },
    }),
    orderBy: () => ({
      limit: (n) => ({
        async get() {
          const rows = [...store.entries()]
            .filter(([k]) => k.startsWith(`${name}/`))
            .map(([, v]) => v)
            .sort((a, b) => String(b.stagedAt).localeCompare(String(a.stagedAt)))
            .slice(0, n);
          return { docs: rows.map((v) => ({ data: () => v })) };
        },
      }),
    }),
  });

  return {
    __store: store,
    collection,
    async getAll(...refs) {
      return refs.map((r) => ({ exists: store.has(r.__path), data: () => store.get(r.__path) }));
    },
    async runTransaction(fn) {
      return fn({
        async get(ref) {
          return { exists: store.has(ref.__path), data: () => store.get(ref.__path) };
        },
        set(ref, value) {
          store.set(ref.__path, value);
        },
      });
    },
  };
}

// --------------------------------------------------------------- existing identity

test("existing identity is resolved by the DERIVED document id, not by a query", async () => {
  const db = fakeDb({ [`parts/${derivePartId("TST-1001")}`]: { part: { partId: "TST-1001" } } });

  const found = await loadExistingPartIdentities(["TST-1001", "TST-9999"], db);

  assert.equal(found.has("TST-1001"), true);
  assert.equal(found.has("TST-9999"), false);
});

test("identity comparison ignores case and spacing, so a re-export cannot smuggle a duplicate past it", async () => {
  const db = fakeDb({ [`parts/${derivePartId("TST-1001")}`]: {} });
  const found = await loadExistingPartIdentities([" tst-1001 "], db);
  // partIdentityKey normalizes; a file that lower-cases its part numbers must still collide.
  assert.equal(found.has("TST-1001"), true);
});

test("an empty or blank input reads nothing at all", async () => {
  const db = fakeDb();
  assert.equal((await loadExistingPartIdentities([], db)).size, 0);
  assert.equal((await loadExistingPartIdentities(["", "   "], db)).size, 0);
});

// --------------------------------------------------------------- job store

test("a job round-trips through its own collection and nowhere else", async () => {
  const db = fakeDb();
  const job = { jobId: "IMP-1", status: "STAGED", stagedAt: "2026-09-04T12:00:00.000Z" };

  await firestoreImportJobStore(db).put(job);

  assert.deepEqual(db.__store.get(`${IMPORT_JOBS_COLLECTION}/IMP-1`), job);
  assert.deepEqual(await firestoreImportJobStore(db).get("IMP-1"), job);
  assert.equal(await firestoreImportJobStore(db).get("IMP-missing"), null);
});

test("claiming a STAGED job succeeds ONCE -- the second claim is refused", async () => {
  const db = fakeDb({ [`${IMPORT_JOBS_COLLECTION}/IMP-1`]: { jobId: "IMP-1", status: "STAGED" } });
  const store = firestoreImportJobStore(db);
  const claimed = { jobId: "IMP-1", status: "EXECUTING" };

  assert.equal(await store.claimForExecution(claimed), true);
  // This is the double-click guard. Two admins approving at once must not both write.
  assert.equal(await store.claimForExecution(claimed), false);
  assert.equal(db.__store.get(`${IMPORT_JOBS_COLLECTION}/IMP-1`).status, "EXECUTING");
});

test("claiming a job that does not exist is refused rather than created", async () => {
  const db = fakeDb();
  assert.equal(await firestoreImportJobStore(db).claimForExecution({ jobId: "IMP-nope", status: "EXECUTING" }), false);
  assert.equal(db.__store.size, 0);
});

test("history is newest-first and bounded", async () => {
  const db = fakeDb({
    [`${IMPORT_JOBS_COLLECTION}/a`]: { jobId: "a", stagedAt: "2026-09-01T00:00:00.000Z" },
    [`${IMPORT_JOBS_COLLECTION}/b`]: { jobId: "b", stagedAt: "2026-09-03T00:00:00.000Z" },
    [`${IMPORT_JOBS_COLLECTION}/c`]: { jobId: "c", stagedAt: "2026-09-02T00:00:00.000Z" },
  });
  const jobs = await firestoreImportJobStore(db).listRecent(2);
  assert.deepEqual(jobs.map((j) => j.jobId), ["b", "c"]);
});

// --------------------------------------------------------------- governed input

test("an imported Part lands in DRAFT no matter what the file claimed", () => {
  const part = toGovernedPartInput({ internalPartNumber: "TST-1001", name: "Widget", status: "ACTIVE" });
  // A spreadsheet can assert a Part is ACTIVE; it cannot substantiate it. Honouring that
  // claim would hand catalog lifecycle authority to whoever exported the file.
  assert.equal(part.status, "DRAFT");
});

test("the governed partId is derived from the Internal Part Number, not taken from the row", () => {
  const part = toGovernedPartInput({ internalPartNumber: "tst-1001", name: "Widget", partId: "ATTACKER-CHOSEN" });
  assert.equal(part.partId, derivePartId("TST-1001"));
  // The IPN itself is passed through unchanged: normalizing it is the governed command's
  // job (parseInternalPartNumber), and a second normalizer here is a second authority.
  assert.equal(part.internalPartNumber, "tst-1001");
});
