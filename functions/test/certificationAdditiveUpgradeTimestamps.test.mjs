// CERT-UPGRADE-TIMESTAMPS-05 -- THE ADDITIVE UPGRADE WOULD HAVE REWRITTEN HISTORY.
//
// ============================ THE DEFECT ============================
//
// merge:true preserves a stored field ONLY when the payload omits it. A field present in the
// payload is overwritten, merge or not. stampedForWrite put BOTH stamps in the payload
// unconditionally, so any writer reusing it to touch an EXISTING document silently replaced that
// document's createdAt and updatedAt.
//
// The additive world upgrader is exactly such a writer. For 1.7.0 -> 1.8.0 its plan is 1093 writes:
// one genuinely new record (warehouses/wh-main) and 1092 existing records whose ONLY difference is
// the certification marker version. Every one of those 1092 would have received a fresh createdAt.
//
// Two consequences, neither cosmetic:
//   createdAt would stop meaning creation time for the entire base world;
//   `accounts` carries FIVE composite indexes ordering by updatedAt DESCENDING, so the customer
//   list would collapse to a single instant and report all 100 accounts as touched at migration
//   time -- while the migration record claimed the baseline was preserved.
//
// ============================ THE SEMANTICS WERE NOT INVENTED ============================
//
// scripts/backfillWriteTimestamps.mjs already ruled on this exact field:
//
//   "updatedAt is a factual claim about when a record was last written. Filling it with a
//    convenient value would replace an honest absence with a dishonest presence ... it would tell
//    an operator that every customer was touched today."
//   "NON-DESTRUCTIVE ... No existing value is replaced -- a document that already has updatedAt is
//    skipped entirely rather than 'corrected'."
//
// An existing stamp is never replaced; a stamp is written only where it states something true.
// That decides all three cases, and these tests pin each one.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(process.cwd(), "..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const {
  stampedForWrite, writeRecords, TIMESTAMP_POLICY,
  differsOnDeclaredFields, classifyTimestampPolicy,
} = await import(L("functions/scripts/certificationWorld/seedWrite.mjs"));
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));
const { MARKER_FIELD, CERTIFICATION_WORLD_VERSION } =
  await import(L("functions/scripts/certificationWorld/manifest.mjs"));

const STAMP = () => "NEW_SERVER_STAMP";
const STORED_CREATED = "STORED_CREATED_AT";
const STORED_UPDATED = "STORED_UPDATED_AT";

/** A recording batch db: captures the LITERAL payload each record would be written with. */
function recordingDb() {
  const writes = [];
  return {
    writes,
    batch: () => ({
      set: (ref, payload, opts) => writes.push({ ref, payload, opts }),
      commit: async () => {},
    }),
    collection: (c) => ({ doc: (id) => ({ __path: `${c}/${id}` }) }),
  };
}

// ============================================================================================
// 1. NEW RECORD -- the one genuinely missing document.
// ============================================================================================
test("a NEW additive record receives both createdAt and updatedAt", async () => {
  const db = recordingDb();
  await writeRecords(db, [{
    collection: "warehouses", id: "wh-main",
    data: { id: "wh-main", status: "ACTIVE" },
    timestampPolicy: TIMESTAMP_POLICY.NEW_RECORD,
  }], STAMP);

  assert.equal(db.writes.length, 1);
  const { payload, opts } = db.writes[0];
  assert.equal(payload.createdAt, "NEW_SERVER_STAMP", "a document that did not exist has no creation instant to preserve");
  assert.equal(payload.updatedAt, "NEW_SERVER_STAMP");
  assert.deepEqual(opts, { merge: true });
});

// ============================================================================================
// 2 & 3. EXISTING RECORDS -- what the payload must NOT contain.
//
// Asserted on the PAYLOAD, not on a post-merge result. merge:true is a Firestore behaviour, and the
// only thing this code controls is which keys it hands over; a field absent from the payload is a
// stored value Firestore leaves alone. Testing the payload tests the actual decision.
// ============================================================================================
test("an EXISTING record's stored createdAt survives the additive upgrade", async () => {
  const db = recordingDb();
  await writeRecords(db, [
    { collection: "accounts", id: "a1", data: { name: "A" }, timestampPolicy: TIMESTAMP_POLICY.CONTENT_UPDATE },
    { collection: "accounts", id: "a2", data: { name: "B" }, timestampPolicy: TIMESTAMP_POLICY.METADATA_ONLY },
  ], STAMP);

  for (const w of db.writes) {
    assert.ok(!("createdAt" in w.payload),
      `${w.ref.__path}: createdAt must never enter the payload for an existing document -- ` +
      "including it is what would have rewritten creation time on all 1092 records");
  }
});

test("MARKER-ONLY difference writes NEITHER timestamp -- updatedAt is preserved", async () => {
  const db = recordingDb();
  await writeRecords(db, [{
    collection: "accounts", id: "cw-acct-0000",
    data: { name: "A", [MARKER_FIELD]: { version: "1.8.0", datasetId: "accounts" } },
    timestampPolicy: TIMESTAMP_POLICY.METADATA_ONLY,
  }], STAMP);

  const { payload } = db.writes[0];
  assert.ok(!("createdAt" in payload));
  assert.ok(!("updatedAt" in payload),
    "nothing a consumer of updatedAt cares about changed; moving it would tell five DESCENDING " +
    "accounts indexes that every customer was touched at migration time");
  assert.deepEqual(payload[MARKER_FIELD], { version: "1.8.0", datasetId: "accounts" },
    "the marker itself IS written -- that is the whole point of the upgrade");
});

test("a CONTENT change advances updatedAt, because the record really was just written", async () => {
  const db = recordingDb();
  await writeRecords(db, [{
    collection: "accounts", id: "a1", data: { name: "Renamed" },
    timestampPolicy: TIMESTAMP_POLICY.CONTENT_UPDATE,
  }], STAMP);
  const { payload } = db.writes[0];
  assert.equal(payload.updatedAt, "NEW_SERVER_STAMP", "updatedAt is a claim about the last write, and this IS one");
  assert.ok(!("createdAt" in payload), "but creation time is not a new fact");
});

// ============================================================================================
// THE CLASSIFIER. One definition, shared with the upgrader, exercised directly.
// ============================================================================================
test("classifyTimestampPolicy names all three cases from the data alone", () => {
  const marker = (v) => ({ [MARKER_FIELD]: { version: v, datasetId: "accounts" } });

  assert.equal(classifyTimestampPolicy({ name: "A", ...marker("1.8.0") }, undefined),
    TIMESTAMP_POLICY.NEW_RECORD, "absent document");
  assert.equal(classifyTimestampPolicy({ name: "A", ...marker("1.8.0") }, undefined),
    classifyTimestampPolicy({ name: "A" }, null), "null and undefined are the same absence");

  assert.equal(
    classifyTimestampPolicy({ name: "A", ...marker("1.8.0") }, { name: "A", ...marker("1.7.0") }),
    TIMESTAMP_POLICY.METADATA_ONLY, "the 1.7.0 -> 1.8.0 case: marker version and nothing else");

  assert.equal(
    classifyTimestampPolicy({ name: "B", ...marker("1.8.0") }, { name: "A", ...marker("1.7.0") }),
    TIMESTAMP_POLICY.CONTENT_UPDATE, "business content moved as well as the marker");

  assert.equal(
    classifyTimestampPolicy({ name: "B", ...marker("1.8.0") }, { name: "A", ...marker("1.8.0") }),
    TIMESTAMP_POLICY.CONTENT_UPDATE, "business content moved with no marker change at all");
});

// ============================================================================================
// 4 & 5. WHAT LIVES ON THE LIVE DOCUMENT MUST SURVIVE.
// ============================================================================================
test("environment-only fields such as userId survive the additive upgrade", () => {
  const expected = { employeeId: "cw-emp-001", firstName: "Dana", [MARKER_FIELD]: { version: "1.8.0", datasetId: "employees" } };
  const stored = { ...expected, [MARKER_FIELD]: { version: "1.7.0", datasetId: "employees" }, userId: "2mSmff2aM2flh6YjSS438BKzq3y1" };

  // A UID is environment state the fixture deliberately does not carry, so it must not read as
  // drift and must not be written away.
  assert.equal(classifyTimestampPolicy(expected, stored), TIMESTAMP_POLICY.METADATA_ONLY,
    "a linked principal is not a content change");
  const payload = stampedForWrite(expected, STAMP, TIMESTAMP_POLICY.METADATA_ONLY);
  assert.ok(!("userId" in payload), "the payload never mentions userId, so merge leaves the link alone");
});

test("non-fixture extra fields on a live record survive and do not read as drift", () => {
  const expected = { name: "A", [MARKER_FIELD]: { version: "1.8.0", datasetId: "accounts" } };
  const stored = {
    ...expected, [MARKER_FIELD]: { version: "1.7.0", datasetId: "accounts" },
    updatedBy: "a-migration", someLaterCommandField: 42, createdAt: STORED_CREATED, updatedAt: STORED_UPDATED,
  };
  assert.equal(differsOnDeclaredFields(expected, stored), true, "the marker version genuinely differs");
  assert.equal(classifyTimestampPolicy(expected, stored), TIMESTAMP_POLICY.METADATA_ONLY,
    "history on the record is history, not drift");

  const payload = stampedForWrite(expected, STAMP, TIMESTAMP_POLICY.METADATA_ONLY);
  for (const k of ["updatedBy", "someLaterCommandField", "createdAt", "updatedAt"]) {
    assert.ok(!(k in payload), `${k} must not appear in the payload`);
  }
});

// ============================================================================================
// 6. THE OTHER DIRECTION. A real content change must still land.
// ============================================================================================
test("business fields still update when the expected world genuinely changes", async () => {
  const expected = { name: "Renamed Co", status: "ACTIVE", [MARKER_FIELD]: { version: "1.8.0", datasetId: "accounts" } };
  const stored = { name: "Old Co", status: "ACTIVE", [MARKER_FIELD]: { version: "1.8.0", datasetId: "accounts" } };
  assert.equal(classifyTimestampPolicy(expected, stored), TIMESTAMP_POLICY.CONTENT_UPDATE);

  const db = recordingDb();
  await writeRecords(db, [{ collection: "accounts", id: "a1", data: expected, timestampPolicy: TIMESTAMP_POLICY.CONTENT_UPDATE }], STAMP);
  assert.equal(db.writes[0].payload.name, "Renamed Co", "the correction must actually be written");
  assert.equal(db.writes[0].payload.updatedAt, "NEW_SERVER_STAMP");
});

// ============================================================================================
// 7. CONVERGENCE. A rerun after a successful application must propose nothing.
// ============================================================================================
test("an additive rerun after successful application proposes ZERO writes", () => {
  const { records } = expectedRecords();
  // The live world as it would stand immediately after the upgrade: every expected record present,
  // carrying the stamps and the environment fields the upgrade did not touch.
  const live = new Map(records.map((r) => [`${r.collection}/${r.id}`, {
    ...r.data, createdAt: STORED_CREATED, updatedAt: STORED_UPDATED,
    ...(r.collection === "employees" ? { userId: `uid-${r.id}` } : {}),
  }]));

  const toWrite = records.filter((r) => {
    const stored = live.get(`${r.collection}/${r.id}`);
    return stored === undefined || differsOnDeclaredFields(r.data, stored);
  });
  assert.equal(toWrite.length, 0,
    "a second run must be a no-op -- otherwise the tool rewrites the world on every invocation " +
    "and its own timestamps become meaningless");
});

// ============================================================================================
// 8. THE ORDINARY SEEDER IS UNCHANGED.
// ============================================================================================
test("ordinary rebuild/seed timestamp behaviour is untouched by this correction", async () => {
  // No policy stated. The default must remain what it has always been, because a rebuild writes
  // documents that genuinely do not exist and the seeder is what put timestamps on the world in
  // the first place (the Customers-list defect that backfillWriteTimestamps repaired).
  const plain = stampedForWrite({ name: "A" }, STAMP);
  assert.equal(plain.createdAt, "NEW_SERVER_STAMP");
  assert.equal(plain.updatedAt, "NEW_SERVER_STAMP");

  const db = recordingDb();
  await writeRecords(db, [{ collection: "accounts", id: "a1", data: { name: "A" } }], STAMP);
  assert.equal(db.writes[0].payload.createdAt, "NEW_SERVER_STAMP");
  assert.equal(db.writes[0].payload.updatedAt, "NEW_SERVER_STAMP");

  // STAMPS STILL GO UNDER THE RECORD. A dataset carrying its own meaningful stamp keeps it.
  const own = stampedForWrite({ name: "A", updatedAt: "FIXTURE_OWN" }, STAMP);
  assert.equal(own.updatedAt, "FIXTURE_OWN");
});

test("an unrecognised policy fails closed rather than defaulting to overwriting", () => {
  assert.throws(() => stampedForWrite({ name: "A" }, STAMP, "SOMETHING_ELSE"), /unknown timestamp policy/);
  // Guessing NEW_RECORD for an unknown policy would silently reintroduce the exact overwrite the
  // constant exists to prevent, on a caller that thought it had asked for something safer.
});

// ============================================================================================
// 9. THE WORLD IDENTITY MUST NOT MOVE. Timestamps are volatile and outside the fingerprint.
// ============================================================================================
test("1.8.0 identity is unchanged by this correction -- timestamps are outside the fingerprint", () => {
  const { world, records } = expectedRecords();
  assert.equal(world.version, "1.8.0");
  assert.equal(CERTIFICATION_WORLD_VERSION, "1.8.0");
  assert.equal(records.length, 1093);
  assert.equal(worldFingerprint(records).hash, "1782e853",
    "this fix changes WRITE BEHAVIOUR, not deterministic world content");
});

// ============================================================================================
// THE PARTIAL-FAILURE BOUNDARY. Pinned, because the recovery rule is not obvious from the code.
// ============================================================================================
test("the 400-record batching and its partial-failure rule are documented where the writer is", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/seedWrite.mjs"), "utf8");
  // Batches commit independently: a 1093-record upgrade is three commits with no transaction
  // spanning them, and the deployment record is written only after all of them succeed.
  assert.match(src, /committed INDEPENDENTLY/i);
  assert.match(src, /NEVER be blindly rerun/i);
  assert.match(src, /STOP, READ, RECONCILE/i);
});

test("a mid-batch failure leaves earlier batches committed, and the count is not a progress report", async () => {
  // Exercised rather than asserted from prose: the second commit throws, and the records from the
  // first batch have already been handed to Firestore.
  const committed = [];
  let batchIndex = 0;
  const db = {
    batch: () => {
      const mine = batchIndex++;
      const staged = [];
      return {
        set: (ref) => staged.push(ref.__path),
        commit: async () => {
          if (mine === 1) throw new Error("network");
          committed.push(...staged);
        },
      };
    },
    collection: (c) => ({ doc: (id) => ({ __path: `${c}/${id}` }) }),
  };
  const many = Array.from({ length: 900 }, (_, i) => ({
    collection: "accounts", id: `a${i}`, data: { n: i }, timestampPolicy: TIMESTAMP_POLICY.METADATA_ONLY,
  }));

  await assert.rejects(() => writeRecords(db, many, STAMP), /network/);
  assert.equal(committed.length, 400, "batch 1 landed; batch 2 did not; batch 3 never ran");
  // No return value survives the throw, so the caller cannot know what landed without re-reading.
  // That is precisely why the recovery rule is STOP, READ, RECONCILE rather than retry.
});
