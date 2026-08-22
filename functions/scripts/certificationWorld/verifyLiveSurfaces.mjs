#!/usr/bin/env node
// SURFACE VERIFICATION — ask the database the questions the SCREENS ask.
//
// ============================ WHY THIS IS NOT A UNIT TEST ============================
//
// Every defect this batch repaired passed its unit tests. The seeder wrote every record
// successfully. `verify` reported COMPLETE. The world fingerprint matched. And 101 of 103 customers
// were missing from the Customers list, because Firestore's `orderBy` silently EXCLUDES documents
// lacking the ordered field -- a property of the QUERY, invisible to any test that checks the data.
//
// So this issues the real ordered reads and the real search range against the real project, and
// compares what comes back to what exists. A record that exists but cannot be retrieved by the
// query its screen runs is, for every practical purpose, absent.
//
// The search query is not reimplemented here: it is built by `accountSearchQueryShape`, the same
// function the browser uses. A verification that builds its own query proves only that the
// verification works.
//
// READ ONLY. Issues queries, writes nothing.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { accountSearchQueryShape } = await import(L("field-ops-app-vite/src/domain/accountSearch.js"));
const { ACCOUNT_STATUS_VALUES, ACCOUNT_RELATIONSHIP_VALUES, QUERY_REQUIRED_FIELDS } =
  await import(L("functions/scripts/certificationWorld/domainContracts.mjs"));
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const PROJECT_ID = flag("--projectId");

function assertKnownTarget(projectId) {
  if (!projectId) throw new Error("--projectId is required.");
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || []).find((e) => e?.firebase?.projectId === projectId);
  if (!env) throw new Error(`Unknown project "${projectId}". Refusing.`);
  return { projectId, role: env.role };
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};

async function main() {
  const target = assertKnownTarget(PROJECT_ID);
  console.log(`target: ${target.projectId} (role=${target.role})\n`);
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  // ── 1. ORDERED READS. For every field declared QUERY_REQUIRED, the ordered read must return
  //       every document in the collection. A shortfall is exactly the invisibility bug.
  console.log("-- ordered reads (orderBy excludes documents missing the field)");
  for (const [collection, fields] of Object.entries(QUERY_REQUIRED_FIELDS)) {
    const total = (await db.collection(collection).count().get()).data().count;
    for (const f of fields) {
      if (f.field === "name") continue; // rendered, not ordered
      const got = (await db.collection(collection).orderBy(f.field, "desc").count().get()).data().count;
      check(`${collection} orderBy(${f.field}) returns every document`, got === total, `${got}/${total} -- ${f.surface}`);
    }
  }

  // ── 2. CANONICAL STATUS. No value outside the domain enum may exist.
  console.log("\n-- canonical enum conformance");
  const accounts = await db.collection("accounts").get();
  const allowedStatus = Object.values(ACCOUNT_STATUS_VALUES);
  const badStatus = accounts.docs.filter((d) => !allowedStatus.includes(d.data().status));
  check("every customer status is a canonical value", badStatus.length === 0,
    badStatus.length ? badStatus.map((d) => `${d.id}=${d.data().status}`).join(", ") : allowedStatus.join("/"));

  const statusTally = {};
  for (const d of accounts.docs) statusTally[d.data().status] = (statusTally[d.data().status] || 0) + 1;
  console.log(`      status distribution: ${JSON.stringify(statusTally)}`);

  const allowedRel = Object.values(ACCOUNT_RELATIONSHIP_VALUES);
  const badRel = accounts.docs.filter((d) => {
    const r = d.data().relationshipTypes;
    if (r === undefined || r === null) return false; // unset is a valid domain state
    return !Array.isArray(r) || r.some((v) => !allowedRel.includes(v));
  });
  check("every relationshipTypes value is canonical", badRel.length === 0,
    badRel.length ? badRel.map((d) => d.id).join(", ") : allowedRel.join("/"));

  // ── 3. RELATIONSHIP FILTER. The filter uses array-contains; verify each arm returns what exists.
  console.log("\n-- relationship filter arms");
  const relTally = { CUSTOMER: 0, VENDOR: 0, BOTH: 0, UNSET: 0 };
  for (const d of accounts.docs) {
    const r = d.data().relationshipTypes;
    if (!Array.isArray(r) || r.length === 0) { relTally.UNSET += 1; continue; }
    const c = r.includes("CUSTOMER"), v = r.includes("VENDOR");
    if (c && v) relTally.BOTH += 1; else if (c) relTally.CUSTOMER += 1; else if (v) relTally.VENDOR += 1;
  }
  console.log(`      fixture spread: ${JSON.stringify(relTally)}`);

  for (const type of allowedRel) {
    const got = (await db.collection("accounts").where("relationshipTypes", "array-contains", type).count().get()).data().count;
    const expectSame = type === "CUSTOMER" ? relTally.CUSTOMER + relTally.BOTH : relTally.VENDOR + relTally.BOTH;
    check(`filter ${type} returns every ${type} customer`, got === expectSame, `${got}/${expectSame} (mixed records appear under both)`);
  }
  check("unset relationship records exist and are not misclassified", relTally.UNSET > 0,
    `${relTally.UNSET} record(s) deliberately unset -- the domain permits it and must not default to Customer`);

  // ── 4. CASE-INSENSITIVE SEARCH, through the browser's own query builder.
  console.log("\n-- customer search (same query shape the browser builds)");
  const runSearch = async (term) => {
    const shape = accountSearchQueryShape({ term });
    if (!shape) return null;
    const snap = await db.collection(shape.collection)
      .where(shape.fieldPath, ">=", shape.start)
      .where(shape.fieldPath, "<=", shape.end)
      .orderBy(shape.fieldPath, "asc")
      .limit(shape.limit)
      .get();
    return snap.docs.map((d) => d.data().name).sort();
  };

  const variants = ["mesquite", "MESQUITE", "Mesquite", "  Mesquite  "];
  const sets = [];
  for (const t of variants) sets.push({ t, names: await runSearch(t) });
  const first = JSON.stringify(sets[0].names);
  const allSame = sets.every((s) => JSON.stringify(s.names) === first);
  check("every casing of 'mesquite' returns the same customers", allSame,
    sets.map((s) => `${JSON.stringify(s.t)}->${s.names.length}`).join("  "));
  check("the search actually finds Mesquite", sets[0].names.length > 0, sets[0].names.join(", ") || "(none)");

  const prefix = await runSearch("soda");
  check("prefix search matches only names STARTING with the term", prefix.every((n) => n.toLowerCase().startsWith("soda")),
    `"soda" -> ${prefix.length} (a substring search would also match "... Soda Works")`);

  const chap = await runSearch("chap");
  check("partial prefix returns its matches", chap.length > 0, `"chap" -> ${chap.join(", ")}`);

  // ── 5. SEARCH RESULTS CAN RENDER. A result whose name is absent is a blank row.
  const namesMissing = accounts.docs.filter((d) => typeof d.data().name !== "string" || !d.data().name.trim());
  check("every customer has a display name to render", namesMissing.length === 0,
    namesMissing.map((d) => d.id).join(", ") || `${accounts.size} named`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} surface checks passed`);
  if (failed.length) {
    console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  "));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err?.message || err}`);
  process.exitCode = 1;
});
