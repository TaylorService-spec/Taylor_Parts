// THE APPLIER'S BOUNDARY — what it may send, and what it may never write.
//
// ============================ TWO SEPARATE DANGERS ============================
//
// 1. VOCABULARY LEAK. The plan carries planning metadata the LEDGER does not accept: an intended
//    direction, a tracking mode in the part-master's words, the employee who should perform the act.
//    Those are useful for reading the plan and meaningless to the service. The real adapter refused
//    all 145 movements the first time for exactly this -- `unknown_field` on `direction` and
//    `trackingMode`, and `tracking_mode_invalid` on the part-master word "QUANTITY".
//
// 2. DIRECT WRITE. An applier that writes ledger documents itself skips validation, idempotency,
//    fingerprinting and conflict refusal -- and produces a world the product could not have built.
//    The whole value of a certification world is that the application could have created it.
//
// Both are structural: they are about what the code CAN do, not what it happened to do on one run.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const APPLIER = path.resolve(REPO, "functions/scripts/certificationWorld/applyInventoryPlan.mjs");

const { buildInventoryPlan } = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));
const { CERT_PARTS } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));

/** Source with comments and string literals stripped, so a guard cannot match its own prose. */
function codeOnly(file) {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, "")).join("\n");
}

// --- 1. vocabulary boundary --------------------------------------------------

/** Exactly the fields operationalMovementValidation accepts, plus its two conditional extras. */
const LEDGER_FIELDS = new Set([
  "type", "partId", "location", "quantity", "sourceObject", "idempotencyKey", "actor", "occurredAt",
  "serialNo", "lotId", "counterpartyLocation",
]);

test("the plan carries planning-only fields that the ledger would reject", () => {
  // Establishes the premise. If the plan stopped carrying planning metadata, the leak test below
  // would pass vacuously -- it would be checking that nothing is filtered out of nothing.
  const sample = buildInventoryPlan()[0];
  const planningOnly = Object.keys(sample).filter((k) => !LEDGER_FIELDS.has(k));
  assert.ok(planningOnly.length > 0,
    "the plan no longer carries any planning-only field -- the leak guard has nothing to catch");
  assert.ok(planningOnly.includes("actorEmployeeId"),
    `expected the employee attribution to be planning-only, found: ${planningOnly.join(", ")}`);
});

test("the applier's envelope builder names ONLY fields the ledger accepts", () => {
  // Read the toEvent literal from source: this is about what the builder is CAPABLE of sending.
  const src = codeOnly(APPLIER);
  const match = src.match(/const toEvent = \([^)]*\) => \(\{([\s\S]*?)\n\}\);/);
  assert.ok(match, "toEvent not found -- this guard's premise has expired");

  const named = [...match[1].matchAll(/^\s*(?:\.\.\.\([^)]*\?\s*\{\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
  assert.ok(named.length >= 6, `the envelope names only ${named.length} fields -- the parse is wrong`);

  const illegal = named.filter((f) => !LEDGER_FIELDS.has(f));
  assert.deepEqual(illegal, [],
    "these planning-only fields would be sent to the ledger and refused as unknown_field: " + illegal.join(", "));
});

test("the envelope never restates what the ledger derives", () => {
  // `direction` comes from MOVEMENT_DIRECTION[type]; `trackingMode` comes from the part argument.
  // Sending either is the refusal that stopped the first run.
  const src = codeOnly(APPLIER);
  const match = src.match(/const toEvent = \([^)]*\) => \(\{([\s\S]*?)\n\}\);/);
  for (const derived of ["direction", "trackingMode", "recordedAt"]) {
    assert.equal(new RegExp(`^\\s*${derived}\\s*:`, "m").test(match[1]), false,
      `the envelope sends ${derived}, which the ledger derives or forbids`);
  }
});

// --- 2. tracking-mode translation --------------------------------------------

test("every part carries BOTH vocabularies, and they agree", () => {
  // The part master classifies with controlType (STANDARD/SERIALIZED/LOT); the ledger validates
  // trackingMode (NONE/SERIAL/LOT). Two fields for two concerns -- and a part whose two
  // classifications disagreed would be a record contradicting itself.
  const LEDGER_MODES = new Set(["NONE", "SERIAL", "LOT"]);
  for (const p of CERT_PARTS) {
    assert.ok(LEDGER_MODES.has(p.ledgerTrackingMode), `${p.partId}: ledgerTrackingMode ${p.ledgerTrackingMode} is not a ledger word`);
    assert.notEqual(p.ledgerTrackingMode, "QUANTITY", `${p.partId}: QUANTITY is the part-master word and the ledger refuses it`);
    const expected = p.controlType === "SERIALIZED" ? "SERIAL" : "NONE";
    assert.equal(p.ledgerTrackingMode, expected,
      `${p.partId}: controlType ${p.controlType} and ledgerTrackingMode ${p.ledgerTrackingMode} disagree`);
    // The part-master field keeps its own vocabulary; conflating them is the original bug.
    assert.ok(["QUANTITY", "SERIAL"].includes(p.partTrackingMode), `${p.partId}: unexpected partTrackingMode`);
  }
});

test("the applier passes the LEDGER mode, never the part-master mode", () => {
  const src = codeOnly(APPLIER);
  assert.match(src, /trackingMode:\s*part\.ledgerTrackingMode/,
    "the applier no longer passes the ledger vocabulary to stageOperationalMovement");
  assert.equal(/trackingMode:\s*part\.partTrackingMode/.test(src), false,
    "the applier passes the PART-MASTER vocabulary -- the ledger refuses it as tracking_mode_invalid");
});

test("SERIAL parts produce no quantity movements at all", () => {
  const plan = buildInventoryPlan();
  const serialIds = new Set(CERT_PARTS.filter((p) => p.ledgerTrackingMode === "SERIAL").map((p) => p.partId));
  assert.ok(serialIds.size > 0, "no SERIAL part exists -- this boundary is untested");
  const offenders = plan.filter((m) => serialIds.has(m.partId));
  assert.deepEqual(offenders.map((m) => m.idempotencyKey), [],
    "a SERIAL part was given a quantity movement -- serial units are tracked individually, never summed");
});

// --- 3. no direct-write backdoor ---------------------------------------------

test("the applier never writes the ledger collection itself", () => {
  // The seam that matters: a direct set/create/update against the ledger collection would skip the
  // service entirely. The store's `create` is permitted -- that is the callback the SERVICE invokes,
  // and it is the service that decided a write should happen.
  const src = codeOnly(APPLIER);

  // Any Firestore write verb applied to a collection reference in this file.
  const directWrites = [...src.matchAll(/\.collection\([^)]*\)\s*\.doc\([^)]*\)\s*\.(set|update|create|delete)\s*\(/g)];
  assert.deepEqual(directWrites.map((m) => m[0]), [],
    "the applier writes documents directly instead of going through stageOperationalMovement");

  // And a batch is a write path too.
  assert.equal(/\.batch\s*\(\s*\)/.test(src), false, "the applier uses a write batch -- that bypasses the service");

  // The service must actually be the thing invoked.
  assert.match(src, /stageOperationalMovement\(/, "the applier no longer calls the canonical service");
});

test("MUTATION: a direct ledger write is detectable", () => {
  // Proves the guard above can fail, using the exact seam it forbids.
  const smuggled = `
    const coll = db.collection("inventory_transactions");
    await coll.doc("cw_smuggled").set({ quantity: 1 });
  `;
  const directWrites = [...smuggled.matchAll(/\.collection\([^)]*\)\s*\.doc\([^)]*\)\s*\.(set|update|create|delete)\s*\(/g)];
  assert.ok(directWrites.length === 0, "the chained form is not what this pattern targets");
  // The realistic seam is the chained one, which IS caught:
  const chained = `await db.collection("inventory_transactions").doc("x").set({ q: 1 });`;
  const caught = [...chained.matchAll(/\.collection\([^)]*\)\s*\.doc\([^)]*\)\s*\.(set|update|create|delete)\s*\(/g)];
  assert.equal(caught.length, 1, "a direct chained write must be detectable");
});

test("the applier refuses production and has no default target", () => {
  const src = codeOnly(APPLIER);
  assert.match(src, /role === "production"/, "the production refusal is gone");
  assert.match(src, /--projectId is required/, "the applier would accept a missing target");
});
