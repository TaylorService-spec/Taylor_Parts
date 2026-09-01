// CERT-VERIFIER-MARKERLESS-06 -- TWO READERS, TWO ANSWERS, ONE OF THEM WRONG.
//
// ============================ WHAT HAPPENED ============================
//
// After the 1.8.0 migration landed, the live world was COMPLETE: 1093/1093 records, expected =
// recorded = observed = 1782e853, warehouses/wh-main stored and VALID through the governed
// validator. verifyPrivateAiFailClosed reported, against that same world:
//
//   warehouses  : 0/1
//   world total : 1092/1093
//
// Neither reader was reading wrong data. They were answering "which live records belong to the
// certification world" with two different algorithms. The verifier ran its own
// `where(certificationWorld.version == world.version)` count per collection, and a markerless
// record cannot appear in that query BY CONSTRUCTION -- the governed warehouse carries no marker
// because validateGovernedWarehouse is closed-key and refuses the field.
//
// So the defect was not the warehouse, the migration, the private-AI posture, or the data. It was a
// duplicated membership definition, introduced when the markerless group was added and propagated
// to only one of its two consumers.
//
// ============================ WHAT THESE TESTS PIN ============================
//
// ONE membership algorithm: certificationWorld.mjs's readInstalled(). Not "the verifier also knows
// about wh-main" -- that would be the same defect with a special case bolted on, and the next
// markerless group would reopen it. The tests below drive the exported reader directly, and assert
// that the verifier has no independent count of its own left.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const REPO = path.resolve(process.cwd(), "..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { expectedRecords, readInstalled } = await import(L("functions/scripts/certificationWorld.mjs"));
const { MARKER_FIELD, CERTIFICATION_WORLD_VERSION } =
  await import(L("functions/scripts/certificationWorld/manifest.mjs"));
const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));

const VERSION = CERTIFICATION_WORLD_VERSION;

/**
 * A fake Firestore holding exactly the documents given. Read-only by construction: it exposes no
 * set/update/delete/batch at all, so a write path introduced into a reader would fail here rather
 * than be caught by a source scan.
 */
function fakeDb(docsByCollection) {
  return {
    collection(name) {
      const rows = docsByCollection[name] ?? [];
      return {
        get: async () => ({
          docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
          size: rows.length,
          empty: rows.length === 0,
          forEach(fn) { this.docs.forEach(fn); },
        }),
      };
    },
  };
}

const marker = (v = VERSION, datasetId = "accounts") => ({ [MARKER_FIELD]: { version: v, datasetId } });

// ============================================================================================
// 1, 2, 3. THE THREE MEMBERSHIP CASES.
// ============================================================================================
test("a marker-bearing expected record is counted normally", async () => {
  const db = fakeDb({ accounts: [{ id: "cw-acct-0000", data: { name: "A", ...marker() } }] });
  const { found } = await readInstalled(db, ["accounts"], new Map());
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "cw-acct-0000");
});

test("a MARKERLESS expected warehouse is counted, by exact builder-owned id", async () => {
  const db = fakeDb({ warehouses: [{ id: "wh-main", data: { id: "wh-main", status: "ACTIVE" } }] });
  const { found } = await readInstalled(db, ["warehouses"], new Map([["warehouses", new Set(["wh-main"])]]));
  assert.equal(found.length, 1, "this is the record the old verifier could not see");
  assert.equal(found[0].id, "wh-main");
  assert.ok(!(MARKER_FIELD in found[0].data), "and it is counted WITHOUT carrying a marker");
});

test("an UNRELATED markerless warehouse in the same collection is NOT counted", async () => {
  // The property that makes marker-scoping safe must survive id-scoping: a document this world did
  // not create is invisible, and therefore never a deletion candidate either.
  const db = fakeDb({
    warehouses: [
      { id: "wh-main", data: { id: "wh-main", status: "ACTIVE" } },
      { id: "wh-someone-elses", data: { id: "wh-someone-elses", status: "ACTIVE" } },
    ],
  });
  const { found } = await readInstalled(db, ["warehouses"], new Map([["warehouses", new Set(["wh-main"])]]));
  assert.deepEqual(found.map((r) => r.id), ["wh-main"]);
});

// ============================================================================================
// 4 & 5. THE COUNTS THE VERIFIER REPORTS, DERIVED THE SAME WAY IT DERIVES THEM.
// ============================================================================================
/** The whole expected world as live documents, minus whatever `omit` names. */
function liveWorld({ omit = [] } = {}) {
  const { records, markerlessIds } = expectedRecords();
  const skip = new Set(omit);
  const byCollection = {};
  for (const r of records) {
    if (skip.has(`${r.collection}/${r.id}`)) continue;
    (byCollection[r.collection] ??= []).push({
      id: r.id,
      data: { ...r.data, ...(r.collection === "employees" ? { userId: `uid-${r.id}` } : {}) },
    });
  }
  return { db: fakeDb(byCollection), records, markerlessIds };
}

async function countInstalled({ omit = [] } = {}) {
  const { db, records, markerlessIds } = liveWorld({ omit });
  const collections = [...new Set(records.map((r) => r.collection))];
  const { found } = await readInstalled(db, collections, markerlessIds);
  const ownedMarkerless = (r) => (markerlessIds.get(r.collection) ?? new Set()).has(r.id);
  const atVersion = found.filter((r) => ownedMarkerless(r) || r.data?.[MARKER_FIELD]?.version === VERSION);
  const byCollection = {};
  for (const r of atVersion) byCollection[r.collection] = (byCollection[r.collection] ?? 0) + 1;
  return { total: atVersion.length, byCollection, expected: records.length, atVersion };
}

test("with wh-main present the verifier's own arithmetic reports 1093/1093 and warehouses 1/1", async () => {
  const c = await countInstalled();
  assert.equal(c.expected, 1093);
  assert.equal(c.total, 1093, "the number that read 1092/1093 before this correction");
  assert.equal(c.byCollection.warehouses, 1, "the number that read 0/1 before this correction");
});

test("removing wh-main produces 1092/1093 and a verifier FAILURE", async () => {
  // The negative must still fail. A reader that admits the warehouse by id must not admit one that
  // is not there -- otherwise the correction would trade a false alarm for a blind spot.
  const c = await countInstalled({ omit: ["warehouses/wh-main"] });
  assert.equal(c.total, 1092);
  assert.equal(c.byCollection.warehouses ?? 0, 0);
  assert.notEqual(c.total, c.expected, "a world missing the governed warehouse must not pass");
});

// ============================================================================================
// 6. MEMBERSHIP COMES FROM THE BUILDER, NOT FROM A HARDCODED LIST.
// ============================================================================================
test("markerless membership comes from expectedRecords(), not a second hardcoded id list", () => {
  const { markerlessIds } = expectedRecords();
  assert.ok(markerlessIds instanceof Map);
  assert.deepEqual([...(markerlessIds.get("warehouses") ?? [])], ["wh-main"]);

  // Neither consumer may carry its own copy of that id. A special case here is the defect again,
  // and it would be invisible until the SECOND markerless group arrived.
  for (const rel of [
    "functions/scripts/certificationWorld/verifyPrivateAiFailClosed.mjs",
  ]) {
    const src = readFileSync(path.resolve(REPO, rel), "utf8");
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /["']wh-main["']/, `${rel} must not name the warehouse id`);
    assert.doesNotMatch(code, /["']warehouses["']/, `${rel} must not special-case the collection`);
  }
});

// ============================================================================================
// 7. THE TWO VERIFIERS MUST AGREE.
// ============================================================================================
test("the private-AI verifier and the canonical world verifier agree on installed count", async () => {
  const { db, records, markerlessIds } = liveWorld();
  const collections = [...new Set(records.map((r) => r.collection))];

  // Both sides now call THE SAME function. Asserted by exercising it once and comparing against the
  // canonical expectation, and by the source check below that the verifier has no count of its own.
  const { found } = await readInstalled(db, collections, markerlessIds);
  assert.equal(found.length, records.length, "installed == expected for a fully seeded world");
  assert.equal(worldFingerprint(found).hash, worldFingerprint(records).hash,
    "and the same documents, not merely the same number of them");

  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/verifyPrivateAiFailClosed.mjs"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /readInstalled/, "the verifier must use the canonical reader");
  assert.doesNotMatch(code, /\.where\(\s*`\$\{MARKER_FIELD\}\.version`/,
    "and must NOT keep its own marker-scoped count -- that duplicate was the defect");
  assert.doesNotMatch(code, /\.count\(\)/,
    "no independent per-collection count may remain");
});

// ============================================================================================
// 8. LINKAGE. Derived from the same set, and still strict.
// ============================================================================================
test("employee->principal linkage still counts only linked employees", async () => {
  const c = await countInstalled();
  const linked = c.atVersion.filter((r) => r.collection === "employees"
    && typeof r.data?.userId === "string" && r.data.userId.length > 0).length;
  assert.equal(linked, 47);

  // An unlinked employee must still be visible as unlinked -- membership changed, strictness did not.
  const { db, records, markerlessIds } = liveWorld();
  const collections = [...new Set(records.map((r) => r.collection))];
  const { found } = await readInstalled(db, collections, markerlessIds);
  const emps = found.filter((r) => r.collection === "employees");
  emps[0].data.userId = "";
  const stillLinked = emps.filter((r) => typeof r.data.userId === "string" && r.data.userId.length > 0).length;
  assert.equal(stillLinked, 46, "a blank userId must not count as linked");
});

// ============================================================================================
// 9, 10, 11. POSTURE, READ-ONLY-NESS, AND TARGET SAFETY ARE UNCHANGED.
// ============================================================================================
test("the private-AI posture and refusal checks are untouched by this correction", () => {
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/verifyPrivateAiFailClosed.mjs"), "utf8");
  assert.match(src, /privateAiSyntheticOperationalInterpretation resolves FALSE for this project/);
  assert.match(src, /resolveSyntheticOperationalInterpretation\(/);
  assert.match(src, /unauthenticated invocation is refused/);
  // The optional authenticated probe stays optional; credentials are never manufactured.
  assert.match(src, /CERT_AI_PROBE_EMAIL/);
});

test("no write path exists in this read-only verifier", () => {
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/verifyPrivateAiFailClosed.mjs"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Anchored to Firestore handles: a bare `.set(` also matches Map.set, and a check that cries wolf
  // is one an operator learns to ignore.
  assert.doesNotMatch(code, /\b(db|collection\([^)]*\)|doc\([^)]*\))\.(set|update|delete|add)\(|\.batch\(|runTransaction\(/,
    "the verifier must contain no Firestore write");
  assert.match(src, /writes performed: NONE/, "and must say so in its own output");
});

test("production refusal and read-target safety remain intact", async () => {
  // EXERCISED, NOT READ. The first draft of this test grepped for "resolveExecutionTarget" and
  // failed -- the verifier consults resolveReadOnlyTarget, which is the correct authority for a
  // command that only reads and must not be trained to demand a live-write flag. A source scan
  // asserted a symbol name; what matters is the decision, so the decision is what runs.
  const { authorizeVerification } =
    await import(L("functions/scripts/certificationWorld/verifyPrivateAiFailClosed.mjs"));

  const saved = { ...process.env };
  for (const k of ["FIRESTORE_EMULATOR_HOST", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]) delete process.env[k];
  const refusal = (args) => {
    try { authorizeVerification(args); return null; } catch (err) { return err.message; }
  };
  try {
    assert.match(refusal(["--projectId", "taylor-parts"]) ?? "", /production/i,
      "production must be refused even for a read-only verification");
    assert.match(refusal(["--projectId", "not-a-registered-project"]) ?? "", /Unknown project/,
      "an unknown project must fail closed");
    assert.match(refusal([]) ?? "", /--projectId is required/,
      "there must be no default target -- a verifier pointed at the wrong world reports a PASS " +
      "about a project nobody asked about");
    // And the certification target it is FOR must still resolve, with no live-write flag demanded.
    assert.equal(refusal(["--projectId", "eos-platform-certification"]), null,
      "a read-only verifier must not require --apply or a live flag");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  }
});

// ============================================================================================
// 12. THE WORLD IDENTITY MUST NOT MOVE. This is a verifier fix, not a world change.
// ============================================================================================
test("1.8.0 identity is unchanged by this verifier correction", () => {
  const { world, records } = expectedRecords();
  assert.equal(world.version, "1.8.0");
  assert.equal(records.length, 1093);
  assert.equal(worldFingerprint(records).hash, "1782e853");
});
