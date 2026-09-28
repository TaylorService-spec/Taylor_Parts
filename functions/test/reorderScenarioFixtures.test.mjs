// SBX-SCN-001 REORDER FIXTURE RETIREMENT -- classification, refusals, and scope.
//
// The tool deletes records, so almost every test here is about something it must NOT do.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const F = await import("../lib/sandboxFixtures/reorderScenarioFixtures.js");
const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

/**
 * A document exactly as the seeder writes it: the declared facts, the scenario marker where that
 * collection carries one, and the run-varying fields the fingerprint deliberately ignores.
 */
const asSeeded = (fixture, over = {}) => ({
  collection: fixture.collection,
  id: fixture.id,
  data: {
    ...fixture.facts,
    ...(F.MARKER_REQUIRED[fixture.collection] ? { scenarioId: F.SCENARIO_ID } : {}),
    createdAt: { seconds: 1789000000 },
    requestedBy: "uid-some-persona",
    recordedBy: "uid-another-persona",
    ...over,
  },
});

const allSeeded = () => F.REORDER_SCENARIO_FIXTURES.map((x) => asSeeded(x));
const manifest = (documents, projectId = F.SANDBOX_PROJECT_ID) =>
  F.buildRetirementManifest({ projectId, documents, sha256Hex });

test("the declared population is the Reorder domain and nothing else", () => {
  assert.deepEqual([...F.REORDER_FIXTURE_COLLECTIONS],
    ["reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids"]);
  // 5 requests + 3 purchase orders + 0 voids, exactly as the sandbox holds them.
  assert.equal(F.REORDER_SCENARIO_FIXTURES.length, 8);
  const byCollection = {};
  for (const x of F.REORDER_SCENARIO_FIXTURES) byCollection[x.collection] = (byCollection[x.collection] ?? 0) + 1;
  assert.deepEqual(byCollection, { reorder_requests: 5, reorder_purchase_orders: 3 });
  assert.deepEqual([...F.SCENARIO_PART_IDS], ["PRT-1001", "PRT-1002", "PRT-1003", "PRT-1006", "PRT-2001"]);
});

test("every declared id matches what the seeder actually writes", () => {
  // Derived from the seeder source, so the declaration cannot drift away from the fixtures it
  // describes without this failing. A tool whose idea of a fixture is stale is a tool that either
  // refuses real fixtures or deletes something else.
  const seeder = readFileSync(join(REPO, "functions/scripts/seedSandboxTransactional.js"), "utf8");
  for (const fixture of F.REORDER_SCENARIO_FIXTURES) {
    assert.match(seeder, new RegExp(`set\\("${fixture.collection}",\\s*"${fixture.id}"`),
      `${fixture.collection}/${fixture.id} is declared but the seeder does not write it`);
  }
  // And nothing the seeder writes to these collections is missing from the declaration.
  const written = [...seeder.matchAll(/set\("(reorder_requests|reorder_purchase_orders|reorder_purchase_order_voids)",\s*"([^"]+)"/g)]
    .map((m) => `${m[1]}|${m[2]}`);
  const declared = new Set(F.REORDER_SCENARIO_FIXTURES.map((x) => `${x.collection}|${x.id}`));
  for (const w of written) assert.ok(declared.has(w), `the seeder writes ${w}, which is not declared`);
});

test("a cleanly seeded sandbox classifies every fixture as CONFIRMED_SYNTHETIC", () => {
  const m = manifest(allSeeded());
  assert.equal(m.counts.CONFIRMED_SYNTHETIC, 8);
  assert.deepEqual(m.refusals, []);
  assert.equal(m.safeToApply, true);
  assert.equal(m.retirable.length, 8);
  for (const c of m.candidates) assert.match(c.fingerprint, /^[0-9a-f]{32}$/);
});

test("PRODUCTION is refused by name", () => {
  const m = manifest(allSeeded(), F.PRODUCTION_PROJECT_ID);
  assert.equal(m.safeToApply, false);
  assert.match(m.refusals[0], /taylor-parts is PRODUCTION/);
});

test("any project that is not the sandbox is refused", () => {
  const m = manifest(allSeeded(), "eos-platform-certification");
  assert.equal(m.safeToApply, false);
  assert.match(m.refusals[0], /only eos-platform-sandbox may be retired/);
});

test("an UNEXPECTED OCCUPANT of a declared id stops the whole run", () => {
  // Somebody's real Reorder, created at an id that happens to collide with a fixture. Deleting it
  // would destroy a business record; the tool refuses, and refuses for everything.
  const docs = allSeeded();
  const target = docs.find((d) => d.collection === "reorder_requests" && d.id === "ro-sbx-002");
  target.data = { ...target.data, partId: "PRT-REAL-9", requestedQty: 77 };
  const m = manifest(docs);
  assert.equal(m.counts.CONTENT_DIVERGED, 1);
  assert.equal(m.safeToApply, false);
  assert.match(m.refusals.join(" "), /occupies a declared fixture id but its facts differ/);
  assert.match(m.refusals.join(" "), /partId: expected "PRT-1003", found "PRT-REAL-9"/);
  assert.equal(m.retirable.length, 7, "the other seven are classified, but the run is refused");
});

test("an EDITED fixture is diverged, not silently retired", () => {
  const docs = allSeeded();
  const po = docs.find((d) => d.collection === "reorder_purchase_orders" && d.id === "ro-sbx-006");
  po.data = { ...po.data, orderedQuantity: 3 };
  const m = manifest(docs);
  assert.equal(m.safeToApply, false);
  assert.match(m.refusals.join(" "), /orderedQuantity: expected 2, found 3/);
});

test("a fixture whose collection is MARKED must carry the marker", () => {
  const docs = allSeeded();
  const po = docs.find((d) => d.collection === "reorder_purchase_orders" && d.id === "ro-sbx-001");
  delete po.data.scenarioId;
  const m = manifest(docs);
  assert.equal(m.counts.MARKER_MISSING, 1);
  assert.equal(m.safeToApply, false);
  assert.match(m.refusals.join(" "), /carries no SBX-SCN-001 marker/);
});

test("reorder_requests are accepted WITHOUT a marker, because the seeder never wrote one there", () => {
  // The marker gap is recorded rather than papered over: requests are proved by the deterministic
  // manifest plus the content fingerprint, which is the evidence that actually exists for them.
  assert.equal(F.MARKER_REQUIRED.reorder_requests, false);
  assert.equal(F.MARKER_REQUIRED.reorder_purchase_orders, true);
  const m = manifest(allSeeded().filter((d) => d.collection === "reorder_requests"));
  assert.equal(m.counts.CONFIRMED_SYNTHETIC, 5);
  assert.equal(m.counts.MARKER_MISSING, 0);
});

test("a document that is not a declared fixture is never a candidate", () => {
  // The real business Reorders that share these collections -- including one raised against a
  // scenario PART by a real person -- must be invisible to this tool.
  const m = manifest([
    ...allSeeded(),
    { collection: "reorder_requests", id: "Sz8QPa815EgkmvmObQ1K", data: { partId: "CW-P-0000", status: "ORDERED" } },
    { collection: "reorder_requests", id: "eA7o3t8DyUXmtg8MCKjT", data: { partId: "PRT-2001", status: "PENDING_REVIEW" } },
    { collection: "reorder_purchase_orders", id: "Sz8QPa815EgkmvmObQ1K", data: { partId: "CW-P-0000", status: "ORDERED" } },
  ]);
  assert.equal(m.candidates.length, 8, "only declared ids are even considered");
  assert.equal(m.retirable.length, 8);
  assert.deepEqual(m.refusals, []);
  assert.ok(!m.candidates.some((c) => c.id === "Sz8QPa815EgkmvmObQ1K"));
  assert.ok(!m.candidates.some((c) => c.id === "eA7o3t8DyUXmtg8MCKjT"),
    "a real Reorder raised against a scenario part is a business record");
});

test("BROKEN LINEAGE is refused: a fixture is never deleted while something it names stays", () => {
  // The purchase order is present and retirable; its Reorder Request has already been removed, so
  // retiring the order alone would leave the chain half-gone.
  const docs = allSeeded().filter((d) => !(d.collection === "reorder_requests" && d.id === "ro-sbx-001"));
  const m = manifest(docs);
  assert.equal(m.safeToApply, false);
  assert.match(m.refusals.join(" "), /names reorder_requests\/ro-sbx-001, which this run is not retiring/);
  assert.ok(m.absent.some((a) => a.collection === "reorder_requests" && a.id === "ro-sbx-001"));
});

test("an EMPTY sandbox is not an error, and is not applyable either", () => {
  const m = manifest([]);
  assert.deepEqual(m.refusals, []);
  assert.equal(m.retirable.length, 0);
  assert.equal(m.safeToApply, false, "there is nothing to retire");
  assert.equal(m.absent.length, 8);
});

test("the manifest carries no credential and no actor identity", () => {
  const m = manifest(allSeeded());
  const serialized = JSON.stringify(m);
  for (const secret of ["uid-some-persona", "uid-another-persona", "requestedBy", "recordedBy", "credential", "token"]) {
    assert.equal(serialized.includes(secret), false, `the manifest must not carry ${secret}`);
  }
});

test("the fingerprint ignores what legitimately varies between seed runs", () => {
  // createdAt and the resolved persona uids differ per environment. If they were fingerprinted,
  // every fixture would look diverged and the tool would retire nothing.
  const a = manifest(allSeeded());
  const b = manifest(F.REORDER_SCENARIO_FIXTURES.map((x) => asSeeded(x, {
    createdAt: { seconds: 1999999999 }, requestedBy: "uid-completely-different",
  })));
  assert.deepEqual(a.candidates.map((c) => c.fingerprint), b.candidates.map((c) => c.fingerprint));
  assert.equal(b.safeToApply, true);
});

test("the scenario's other domains are out of scope by construction", () => {
  // The scenario also owns Work Orders, customers, equipment and inventory. Sharing a scenario is
  // not a reason to delete something, and the tool cannot even name those collections.
  for (const c of ["fieldops_wos", "accounts", "equipment", "warehouses", "parts", "inventory_transactions"]) {
    assert.equal(F.REORDER_FIXTURE_COLLECTIONS.includes(c), false, `${c} must be out of scope`);
  }
});

test("the runner defaults to DRY RUN and requires an explicit flag to delete", () => {
  const runner = readFileSync(join(REPO, "functions/scripts/retireReorderScenarioFixtures.js"), "utf8");
  assert.match(runner, /out = \{ apply: false \}/, "APPLY is opt-in, never the default");
  assert.match(runner, /if \(!args\.apply\)/, "a run without --apply stops before deleting");
  assert.match(runner, /is PRODUCTION\. This tool deletes records and never runs there/);
  assert.match(runner, /assertSandboxTarget/, "the registry guard runs as well as the by-name refusal");
  // The manifest is written BEFORE any delete, in both modes.
  assert.ok(runner.indexOf("writeFileSync") < runner.indexOf(".delete()"),
    "the pre-delete manifest must be durable before anything is removed");
});
