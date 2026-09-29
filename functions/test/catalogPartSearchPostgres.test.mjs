// THE GOVERNED PART SEARCH CONTRACT, against a real PostgreSQL.
//
// The Part Master administration screen moved off Firestore onto `searchParts` / `countParts`. What it
// needs from them is what this suite proves: IN filters over the governed enums, a stated sort with a
// KEYSET cursor that is correct in BOTH directions, a cursor that is refused rather than misapplied
// under any other sort, a count over the SAME filters -- and, as much as any of that, that the
// historical id-ordered page every picker relies on is exactly what it was.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const partWriter = require("../lib/catalogMaster/postgresPartMasterWriter.js");
const reads = require("../lib/catalogMaster/postgresCatalogReads.js");

// UNIQUE per run: parallel lanes share the cluster, never a database.
const DB_NAME = `cat_psearch_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const CAPS = new Set(["inventory.catalog.manage", "inventory.catalog.activate", "equipment.model.manage"]);
const actor = (tenantId, principalId) => Object.freeze({ tenantId, principalId, capabilities: CAPS });
const refusedWith = (code) => (e) => {
  assert.equal(e.category, "INVALID_INPUT", `expected INVALID_INPUT, got ${e.category}: ${e.message}`);
  assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
  return true;
};

test("the governed Part search contract", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 4 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  let tick = 0;
  const deps = { pool, now: () => new Date(Date.UTC(2026, 8, 20, 12, 0, 0, tick++)) };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  for (const [id, tenant] of [["p1", "t1"], ["p2", "t2"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${id}`, tenant, id]);
  }

  // 23 Parts in t1 across every status and three stocking classes, with DUPLICATE part numbers and
  // statuses so the tiebreaker is exercised on every page boundary, not just in theory.
  const STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "SUPERSEDED", "DISCONTINUED"];
  const CLASSES = ["STOCKED", "NON_STOCK", "KIT"];
  const fixtures = [];
  for (let i = 0; i < 23; i += 1) {
    const id = `P-${String(i).padStart(3, "0")}`;
    const f = { id, ipn: `IPN-${String(i % 7).padStart(2, "0")}`, status: STATUSES[i % 5], stockingClass: CLASSES[i % 3] };
    fixtures.push(f);
    await partWriter.createPart(deps, actor("t1", "p1"), {
      part: {
        partId: id, internalPartNumber: f.ipn, name: `Part ${i}`, status: "ACTIVE", category: "C",
        stockingUnit: "EACH", controlType: "STANDARD", stockingClass: f.stockingClass,
        flags: { expiryTracked: false, consumable: false, returnableCore: false }, wholeUnit: false,
      },
    });
    // Status is set directly: this suite is about READING a catalogue in every state, not about the
    // lifecycle transitions the writer suite already proves.
    await q(`UPDATE eos_ops.parts SET status = $1::eos_ops.ops_part_status WHERE tenant_id='t1' AND id=$2`, [f.status, id]);
  }
  // Another tenant's Part with a colliding id and number. It must never appear in t1's answers.
  await partWriter.createPart(deps, actor("t2", "p2"), {
    part: {
      partId: "P-000", internalPartNumber: "IPN-00", name: "Other tenant", status: "ACTIVE", category: "C",
      stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
      flags: { expiryTracked: false, consumable: false, returnableCore: false }, wholeUnit: false,
    },
  });

  const withConn = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };
  const search = (input) => withConn((c) => reads.searchParts(c, "t1", input));
  const count = (filters) => withConn((c) => reads.countParts(c, "t1", filters));
  /** Walk every page under one input, asserting each cursor is honoured. */
  const walk = async (input) => {
    const ids = [];
    let cursor = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await search({ ...input, cursor });
      ids.push(...page.parts.map((p) => p.id));
      if (!page.nextCursor) return ids;
      cursor = page.nextCursor;
    }
    throw new Error("paging did not terminate");
  };
  /** PostgreSQL's own answer to the same ordering, in one unbounded statement -- the oracle. */
  const oracle = async (orderSql, whereSql = "TRUE", values = []) =>
    (await q(`SELECT id FROM eos_ops.parts WHERE tenant_id='t1' AND ${whereSql} ORDER BY ${orderSql}`, values)).rows.map((r) => r.id);

  await t.test("DEFAULT behaviour is unchanged: ORDER BY id, and the cursor is the last id", async () => {
    const first = await search({ limit: 5 });
    assert.deepEqual(first.parts.map((p) => p.id), ["P-000", "P-001", "P-002", "P-003", "P-004"]);
    assert.equal(first.nextCursor, "P-004", "the id-mode cursor is still the plain last id");
    const second = await search({ limit: 5, cursor: first.nextCursor });
    assert.equal(second.parts[0].id, "P-005");
    assert.deepEqual(await walk({ limit: 4 }), await oracle("id"));
    const lastPage = await search({ limit: 5, cursor: "P-020" });
    assert.deepEqual(lastPage.parts.map((p) => p.id), ["P-021", "P-022"]);
    assert.equal(lastPage.nextCursor, null, "the end of the catalogue is stated, not guessed");
  });

  await t.test("tenant scoping holds for pages and counts", async () => {
    const all = await walk({ limit: 100 });
    assert.equal(all.length, 23);
    assert.equal(await count(), 23);
    assert.equal(await withConn((c) => reads.countParts(c, "t2")), 1);
    const other = await withConn((c) => reads.searchParts(c, "t2", { sort: { field: "internalPartNumber", direction: "ASC" } }));
    assert.deepEqual(other.parts.map((p) => p.name), ["Other tenant"]);
  });

  await t.test("statuses / stockingClasses are IN filters; status / stockingClass remain EQUALS", async () => {
    const byIn = await walk({ statuses: ["ACTIVE", "DRAFT"], limit: 3 });
    assert.deepEqual(byIn, await oracle("id", "status::text = ANY($1)", [["ACTIVE", "DRAFT"]]));
    assert.ok(byIn.length > 0);
    const byEq = await walk({ status: "ACTIVE", limit: 3 });
    assert.deepEqual(byEq, fixtures.filter((f) => f.status === "ACTIVE").map((f) => f.id));
    const combined = await walk({ statuses: ["ACTIVE", "INACTIVE"], stockingClasses: ["KIT", "STOCKED"], limit: 2 });
    assert.deepEqual(combined, fixtures
      .filter((f) => ["ACTIVE", "INACTIVE"].includes(f.status) && ["KIT", "STOCKED"].includes(f.stockingClass))
      .map((f) => f.id));
    const oneClass = await walk({ stockingClass: "NON_STOCK", limit: 100 });
    assert.deepEqual(oneClass, fixtures.filter((f) => f.stockingClass === "NON_STOCK").map((f) => f.id));
  });

  await t.test("countParts counts the SAME set the page lists", async () => {
    for (const filters of [
      {}, { status: "ACTIVE" }, { statuses: ["ACTIVE", "DRAFT"] }, { stockingClass: "KIT" },
      { statuses: ["SUPERSEDED"], stockingClasses: ["NON_STOCK", "KIT"] }, { query: "IPN-03" },
    ]) {
      const listed = await walk({ ...filters, limit: 4, sort: { field: "internalPartNumber", direction: "DESC" } });
      assert.equal(await count(filters), listed.length, `count ${JSON.stringify(filters)}`);
    }
    assert.equal(await count({ statuses: ["SUPERSEDED"], stockingClasses: ["SERVICE"] }), 0, "an empty set counts 0 honestly");
  });

  await t.test("a stated sort pages with a KEYSET cursor, correct in BOTH directions", async () => {
    for (const [field, expr] of [
      ["internalPartNumber", "internal_part_number"], ["status", "status::text"], ["id", "id"],
      ["name", "name"], ["stockingClass", "stocking_class::text"], ["createdAt", "created_at"], ["updatedAt", "updated_at"],
    ]) {
      for (const direction of ["ASC", "DESC"]) {
        const sort = { field, direction };
        for (const limit of [1, 3, 5, 100]) {
          const walked = await walk({ sort, limit });
          const expected = field === "id" ? await oracle(`id ${direction}`) : await oracle(`${expr} ${direction}, id ${direction}`);
          assert.deepEqual(walked, expected, `${field} ${direction} limit ${limit}`);
          assert.equal(new Set(walked).size, walked.length, "no row repeated across pages");
        }
      }
    }
    // With a filter too: the keyset and the filter compose.
    const sort = { field: "internalPartNumber", direction: "DESC" };
    assert.deepEqual(
      await walk({ sort, statuses: ["ACTIVE", "DRAFT", "INACTIVE"], limit: 2 }),
      await oracle("internal_part_number DESC, id DESC", "status::text = ANY($1)", [["ACTIVE", "DRAFT", "INACTIVE"]]),
    );
  });

  await t.test("a sorted cursor is opaque and is REFUSED under any other sort or mode", async () => {
    const asc = { field: "internalPartNumber", direction: "ASC" };
    const page = await search({ sort: asc, limit: 3 });
    assert.ok(page.nextCursor && page.nextCursor.startsWith("k1."), "a keyset cursor, not a bare value");
    assert.equal(page.nextCursor.includes("IPN-"), false, "opaque: the sort value is not legible in it");
    await assert.rejects(search({ sort: { field: "internalPartNumber", direction: "DESC" }, cursor: page.nextCursor }),
      refusedWith("SEARCH_CURSOR_SORT_MISMATCH"));
    await assert.rejects(search({ sort: { field: "status", direction: "ASC" }, cursor: page.nextCursor }),
      refusedWith("SEARCH_CURSOR_SORT_MISMATCH"));
    await assert.rejects(search({ cursor: page.nextCursor }), refusedWith("SEARCH_CURSOR_SORT_MISMATCH"),
      "a keyset cursor replayed in id mode is refused, never compared against ids");
    const idPage = await search({ limit: 3 });
    await assert.rejects(search({ sort: asc, cursor: idPage.nextCursor }), refusedWith("SEARCH_CURSOR_SORT_MISMATCH"),
      "an id-mode cursor replayed under a sort is refused");
    await assert.rejects(search({ sort: asc, cursor: "k1.not-json" }), refusedWith("SEARCH_CURSOR_MALFORMED"));
    const forged = "k1." + Buffer.from(JSON.stringify({ f: "internalPartNumber", d: "ASC", v: "x", id: "bad id!" })).toString("base64url");
    await assert.rejects(search({ sort: asc, cursor: forged }), refusedWith("SEARCH_CURSOR_MALFORMED"));
  });

  await t.test("every value is checked against the governed vocabulary, never passed through", async () => {
    await assert.rejects(search({ status: "ACTIV" }), refusedWith("SEARCH_FILTER_UNKNOWN_VALUE"));
    await assert.rejects(search({ statuses: ["ACTIVE", "active"] }), refusedWith("SEARCH_FILTER_UNKNOWN_VALUE"));
    await assert.rejects(search({ stockingClass: "BULK" }), refusedWith("SEARCH_FILTER_UNKNOWN_VALUE"));
    await assert.rejects(search({ stockingClasses: ["KIT", "'; DROP TABLE eos_ops.parts; --"] }), refusedWith("SEARCH_FILTER_UNKNOWN_VALUE"));
    await assert.rejects(search({ controlType: "SERIAL" }), refusedWith("SEARCH_FILTER_UNKNOWN_VALUE"));
    await assert.rejects(search({ statuses: [] }), refusedWith("SEARCH_FILTER_MALFORMED"), "an empty IN is refused, not answered 'no parts'");
    await assert.rejects(search({ statuses: "ACTIVE" }), refusedWith("SEARCH_FILTER_MALFORMED"));
    await assert.rejects(search({ status: 7 }), refusedWith("SEARCH_FILTER_MALFORMED"));
    await assert.rejects(search({ wholeUnit: "true" }), refusedWith("SEARCH_FILTER_MALFORMED"));
    await assert.rejects(search({ status: "ACTIVE", statuses: ["DRAFT"] }), refusedWith("SEARCH_FILTER_AMBIGUOUS"));
    await assert.rejects(search({ sort: { field: "category", direction: "ASC" } }), refusedWith("SEARCH_SORT_UNKNOWN_FIELD"));
    await assert.rejects(search({ sort: { field: "internal_part_number", direction: "ASC" } }), refusedWith("SEARCH_SORT_UNKNOWN_FIELD"));
    await assert.rejects(search({ sort: { field: "status", direction: "asc" } }), refusedWith("SEARCH_SORT_MALFORMED"));
    await assert.rejects(search({ sort: "status" }), refusedWith("SEARCH_SORT_MALFORMED"));
    await assert.rejects(count({ statuses: ["NOPE"] }), refusedWith("SEARCH_FILTER_UNKNOWN_VALUE"), "the count refuses the same way");
    // The catalogue survived every one of those.
    assert.equal(await count(), 23);
  });

  await t.test("the limit is still clamped, never trusted", async () => {
    const page = await search({ limit: 1_000_000, sort: { field: "status", direction: "DESC" } });
    assert.equal(page.limit, reads.PART_SEARCH_MAX_LIMIT);
    assert.equal(page.parts.length, 23);
    assert.equal(page.nextCursor, null);
  });
});
