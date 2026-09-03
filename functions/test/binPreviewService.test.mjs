// BIN PREVIEW — the trusted read that answers "what would createBin do?".
// Run: node --test test/binPreviewService.test.mjs
//
// No emulator. The service touches a deliberately narrow Firestore surface -- a collection listing
// and two document gets -- so an in-memory double exercises the whole contract deterministically.
// The double also RECORDS any write it is asked for, which is what makes "preview writes nothing"
// a proof rather than a claim: a write path added later fails this file.
import assert from "node:assert/strict";
import test from "node:test";
import {
  previewBinCreates,
  BinPreviewInvalidError,
  BIN_PREVIEW_MAX_PROPOSALS,
} from "../lib/inventoryLocation/binPreviewService.js";
import {
  deriveBinId,
  deriveBinClaimId,
  fingerprintBinCreate,
  toBinCreateIdentity,
  formatBinCode,
  BIN_SCHEMA_VERSION,
  DEFAULT_BIN_CODE_FORMAT,
} from "../lib/inventoryLocation/binRegistry.js";

const WAREHOUSES = ["WH-1", "WH-2"];

/** Any mutation attempt lands in `writes` instead of happening. */
function fakeDb(docs = {}) {
  const writes = [];
  const doc = (path) => ({
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(docs, path),
      data: () => docs[path],
    }),
    set: (...a) => writes.push(["set", path, a]),
    update: (...a) => writes.push(["update", path, a]),
    delete: (...a) => writes.push(["delete", path, a]),
    create: (...a) => writes.push(["create", path, a]),
  });
  return {
    writes,
    collection: (name) => ({
      doc: (id) => doc(`${name}/${id}`),
      add: (...a) => writes.push(["add", name, a]),
      get: async () =>
        name === "warehouses"
          ? { docs: WAREHOUSES.map((id) => ({ id, data: () => ({}) })) }
          : { docs: [] },
    }),
    runTransaction: () => {
      throw new Error("preview must never open a transaction");
    },
    batch: () => {
      throw new Error("preview must never open a batch");
    },
  };
}

const identity = (over = {}) => ({
  warehouseId: "WH-1", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3,
  idempotencyKey: "binadm:v1:WH-1:PARTS_ROOM:A:1:3", ...over,
});
const CODE = formatBinCode({ aisle: "A", bay: 1, position: 3 }, DEFAULT_BIN_CODE_FORMAT).value;

/** Exactly the document createBin would have written for this request. */
function storedBinFor(req, over = {}) {
  return {
    warehouseId: req.warehouseId, area: req.area, aisle: req.aisle, bay: req.bay,
    position: req.position, code: CODE, name: null, status: "ACTIVE", version: 1,
    schemaVersion: BIN_SCHEMA_VERSION, idempotencyKey: req.idempotencyKey,
    fingerprint: fingerprintBinCreate(toBinCreateIdentity(req)),
    ...over,
  };
}
const binPath = (req) => `bins/${deriveBinId(req.idempotencyKey)}`;
const claimPath = (req) => `bin_code_claims/${deriveBinClaimId(req.warehouseId, CODE)}`;

const preview = async (db, proposals) => (await previewBinCreates(db, { proposals })).rows;

test("an empty registry classifies every proposal NEW", async () => {
  const rows = await preview(fakeDb(), [identity()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].classification, "NEW");
  assert.equal(rows[0].reason, null);
});

test("preview writes zero documents and opens no transaction", async () => {
  const req = identity();
  const db = fakeDb({
    [binPath(req)]: storedBinFor(req),
    [claimPath(req)]: { binId: deriveBinId(req.idempotencyKey), claimState: "HELD" },
  });
  await preview(db, [req, identity({ position: 5, idempotencyKey: "k-new" })]);
  assert.deepEqual(db.writes, []);
});

test("the previewed code is the code createBin would author", async () => {
  const rows = await preview(fakeDb(), [identity()]);
  assert.equal(rows[0].code, CODE);
  assert.equal(rows[0].code, "A01-003");
});

test("ALREADY_EXISTS means createBin would replay unchanged", async () => {
  const req = identity();
  const db = fakeDb({
    [binPath(req)]: storedBinFor(req),
    [claimPath(req)]: { binId: deriveBinId(req.idempotencyKey), claimState: "HELD" },
  });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "ALREADY_EXISTS");
});

test("the same location under a DIFFERENT historical key is CODE_RESERVED, not ALREADY_EXISTS", async () => {
  const historical = identity({ idempotencyKey: "legacy-import-77" });
  const db = fakeDb({
    [binPath(historical)]: storedBinFor(historical),
    [claimPath(historical)]: { binId: deriveBinId(historical.idempotencyKey), claimState: "HELD" },
  });
  const rows = await preview(db, [identity()]);
  assert.equal(rows[0].classification, "CODE_RESERVED");
  assert.equal(rows[0].reason, "code_reserved_by_another_bin");
});

test("a SUPERSEDED claim reserves the code just as permanently as a HELD one", async () => {
  const req = identity();
  const db = fakeDb({ [claimPath(req)]: { binId: "bin_someoneelse", claimState: "SUPERSEDED" } });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "CODE_RESERVED");
});

test("a claim with no binId fails visible rather than reading as free", async () => {
  const req = identity();
  const db = fakeDb({ [claimPath(req)]: { claimState: "HELD" } });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "INTEGRITY_ERROR");
  assert.equal(rows[0].reason, "claim_unreadable");
});

test("a stored bin at an unexpected schema version is INTEGRITY_ERROR", async () => {
  const req = identity();
  const db = fakeDb({ [binPath(req)]: storedBinFor(req, { schemaVersion: 1 }) });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "INTEGRITY_ERROR");
  assert.equal(rows[0].reason, "bin_schema_version");
});

test("a stored bin that disagrees with the request is INTEGRITY_ERROR", async () => {
  const req = identity();
  const db = fakeDb({ [binPath(req)]: storedBinFor(req, { aisle: "B" }) });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "INTEGRITY_ERROR");
  assert.equal(rows[0].reason, "bin_disagrees_with_request");
});

test("a stored bin whose fingerprint disagrees with itself is INTEGRITY_ERROR", async () => {
  const req = identity();
  const db = fakeDb({ [binPath(req)]: storedBinFor(req, { fingerprint: "0000000000000000" }) });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "INTEGRITY_ERROR");
  assert.equal(rows[0].reason, "bin_fingerprint_mismatch");
});

test("a claim pointing at a different bin than the one stored is INTEGRITY_ERROR", async () => {
  const req = identity();
  const db = fakeDb({
    [binPath(req)]: storedBinFor(req),
    [claimPath(req)]: { binId: "bin_elsewhere", claimState: "HELD" },
  });
  const rows = await preview(db, [req]);
  assert.equal(rows[0].classification, "INTEGRITY_ERROR");
  assert.equal(rows[0].reason, "claim_points_elsewhere");
});

test("preview refuses the same caller-authored fields createBin refuses", async () => {
  const rows = await preview(fakeDb(), [
    { ...identity(), binId: "bin_mine" },
    { ...identity(), code: "A01-003" },
    identity({ idempotencyKey: "   " }),
    identity({ warehouseId: "WH-NOPE" }),
  ]);
  assert.deepEqual(rows.map((r) => r.classification), ["INVALID", "INVALID", "INVALID", "INVALID"]);
  assert.equal(rows[0].reason, "bin_id_not_accepted");
  assert.equal(rows[1].reason, "code_not_accepted");
  assert.equal(rows[2].reason, "idempotency_key_invalid");
  // An INVALID row carries no derived location, because nothing was validly derived.
  assert.equal(rows[0].code, null);
});

test("one invalid proposal does not suppress the verdicts around it", async () => {
  const rows = await preview(fakeDb(), [
    identity({ position: 1, idempotencyKey: "k1" }),
    { ...identity(), binId: "bin_mine" },
    identity({ position: 5, idempotencyKey: "k5" }),
  ]);
  assert.deepEqual(rows.map((r) => r.classification), ["NEW", "INVALID", "NEW"]);
});

test("an oversized batch is refused, never silently truncated", async () => {
  const many = Array.from({ length: BIN_PREVIEW_MAX_PROPOSALS + 1 }, (_, i) =>
    identity({ position: i + 1, idempotencyKey: `k-${i}` }));
  await assert.rejects(
    () => previewBinCreates(fakeDb(), { proposals: many }),
    (e) => e instanceof BinPreviewInvalidError && e.message === "too_many_proposals",
  );
});

test("a full batch at the limit is accepted", async () => {
  const many = Array.from({ length: BIN_PREVIEW_MAX_PROPOSALS }, (_, i) =>
    identity({ position: i + 1, idempotencyKey: `k-${i}` }));
  const rows = await preview(fakeDb(), many);
  assert.equal(rows.length, BIN_PREVIEW_MAX_PROPOSALS);
});

test("an empty batch is a valid no-op, and a non-array is refused", async () => {
  assert.deepEqual(await preview(fakeDb(), []), []);
  await assert.rejects(
    () => previewBinCreates(fakeDb(), { proposals: "A,B" }),
    (e) => e instanceof BinPreviewInvalidError && e.message === "proposals_required",
  );
});

test("every row echoes the key it was asked about, so callers align by key not by luck", async () => {
  const rows = await preview(fakeDb(), [
    identity({ idempotencyKey: "k-a" }),
    identity({ position: 5, idempotencyKey: "k-b" }),
  ]);
  assert.deepEqual(rows.map((r) => r.idempotencyKey), ["k-a", "k-b"]);
});
