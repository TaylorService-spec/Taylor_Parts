// THE ASSISTANT IS A READ AMPLIFIER. THIS FILE IS THE MECHANICAL LIMIT ON THE AMPLIFICATION.
//
// An assistant that can read a record its human principal could not is an authorization bypass that
// leaves NO TRACE in the surface it bypassed: the reorder queue logs nothing, the balance surface
// logs nothing, and the only evidence is a sentence in a chat panel. An assistant that can WRITE is
// an ungoverned writer wearing a helpful name.
//
// The existing suites assert the BEHAVIOUR of today's assembler. This file asserts the SHAPE of the
// whole AI/assistant surface, so the properties survive the next file somebody adds to it:
//
//   1. No authorization decision in the AI surface is made from a role STRING, except the one
//      registered gap (Work Order visibility) for which the capability catalog holds no id.
//   2. Every capability the AI surface authorizes against is a REGISTERED catalog id, so the
//      assistant cannot acquire an authority model of its own under an ai.* namespace.
//   3. Nothing in the AI surface can write. Not a Firestore write, not a batch, not a FieldValue.
//   4. The AI surface exposes exactly the callables it is known to expose.
//   5. Behaviourally: with zero governed capability, an "admin" reads NOTHING -- the role string is
//      no longer an input to what may be retrieved.
//
// Check 5 is the regression this file exists for. Before the governed routing landed, procurement
// evidence and reorder eligibility were decided by `caller.role === "admin" || "dispatcher"` --
// a SECOND authorization path, keyed on the legacy compatibility `users/{uid}.role` field, that
// resolveEffectivePermission and the capability catalog never saw. A principal whose governed
// authority had been revoked kept both for as long as that legacy string said "admin".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
import {
  assembleWorkOrderReadinessContext,
  buildWorkOrderInterpretationInput,
  PROCUREMENT_EVIDENCE_READ_CAPABILITY,
  REORDER_REQUEST_ELIGIBILITY_CAPABILITY,
  WORK_ORDER_READINESS_CAPABILITIES,
} from "../lib/ai/workOrderReadinessContext.js";

const SRC = join(fileURLToPath(new URL("../", import.meta.url)), "src");
const SURFACE_ROOTS = ["ai", "assistant"];

function sourceFiles() {
  const out = [];
  const walk = (rel) => {
    const abs = join(SRC, rel);
    for (const entry of readdirSync(abs).sort()) {
      const childRel = `${rel}/${entry}`;
      if (statSync(join(abs, entry)).isDirectory()) walk(childRel);
      else if (entry.endsWith(".ts")) out.push({ path: childRel, text: readFileSync(join(abs, entry), "utf8") });
    }
  };
  for (const root of SURFACE_ROOTS) walk(root);
  return out;
}

/**
 * Strip comments before scanning.
 *
 * Every module in this surface DOCUMENTS the patterns it refuses, at length. A scanner that read
 * prose would fire on the very comments explaining why the code does not do the thing -- and the
 * only way to quiet it would be to delete the explanation, which is the opposite of the goal.
 */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FILES = sourceFiles();
assert.ok(FILES.length >= 25, "the surface scan found suspiciously few files");

// --- 1. authority is never a role string ---------------------------------------------------------

/**
 * The one registered exception, and why it is not simply fixed here.
 *
 * `workOrderContext.ts` decides Work Order VISIBILITY from `users/{uid}.role` because the permission
 * catalog registers no `workOrder.read` id -- only workOrder.create / transition / cancel / labor.* /
 * parts.plan. Inventing one under this lane's authority would put a capability in the catalog that no
 * Role grants and no other surface honours, which is a worse outcome than a visible, frozen gap.
 *
 * Freezing it here is the point: this predicate may stay, and a SECOND one may not appear.
 */
const REGISTERED_ROLE_STRING_AUTHORITY = Object.freeze(["ai/workOrderContext.ts"]);

const EOS_ROLE_STRING = /\brole\s*(?:===|!==|==|!=)\s*["'`](?:admin|dispatcher|technician|owner)["'`]/;

test("no authority decision in the AI surface is made from a role string, beyond the registered gap", () => {
  const offenders = FILES.filter((f) => EOS_ROLE_STRING.test(code(f.text))).map((f) => f.path);
  assert.deepEqual(
    offenders.sort(),
    [...REGISTERED_ROLE_STRING_AUTHORITY].sort(),
    "a new role-string authorization appeared in the AI surface. Resolve it through "
      + "resolveEffectiveAccess against a registered capability instead -- a role string is a second "
      + "authorization model the capability catalog cannot see, audit or revoke.",
  );
});

test("the context assembler that feeds the model holds no role-string authority at all", () => {
  // This file decides what is RETRIEVED and what leaves the EOS boundary. It is named separately
  // from the check above so that adding it back to the registered list is a deliberate, visible act.
  const assembler = FILES.find((f) => f.path === "ai/workOrderReadinessContext.ts");
  assert.ok(assembler, "the readiness assembler moved; this guard must follow it");
  assert.doesNotMatch(code(assembler.text), EOS_ROLE_STRING);
});

// --- 2. every capability is a registered catalog id ----------------------------------------------

test("every capability the AI surface authorizes against is registered in the permission catalog", () => {
  const registered = new Set(PERMISSION_CATALOG.map((p) => p.id));
  assert.ok(WORK_ORDER_READINESS_CAPABILITIES.length === 3);
  for (const id of WORK_ORDER_READINESS_CAPABILITIES) {
    assert.ok(
      registered.has(id),
      `"${id}" is not in the permission catalog. The assistant must not carry an authority model of `
        + "its own -- a capability only it knows about is one no Role grants and no admin can revoke.",
    );
  }
  // And specifically: nothing in an ai.* / assistant.* namespace.
  for (const id of WORK_ORDER_READINESS_CAPABILITIES) {
    assert.doesNotMatch(id, /^(ai|assistant)\./);
  }
});

// --- 3. nothing here can write -------------------------------------------------------------------

/**
 * Firestore write primitives, in the CHAINED form they must take to reach a document.
 *
 * Matching a bare `.set(` / `.add(` would fire on `Map.set` and `Set.add`, which this surface uses
 * legitimately (the tool registry is a Map; effective authority is a Set). Requiring the
 * `.doc(...)`/`.collection(...)` prefix targets the actual write and nothing else.
 */
const WRITE_PRIMITIVES = [
  { name: "a document write", re: /\.(?:doc|collection)\s*\([^)]*\)\s*\.\s*(?:set|update|delete|create|add)\s*\(/ },
  { name: "a FieldValue sentinel", re: /\bFieldValue\b/ },
  { name: "a batched write", re: /\bwriteBatch\b|\bbulkWriter\b|\.batch\s*\(\s*\)/ },
  { name: "a transaction", re: /\brunTransaction\b/ },
];

test("no file in the AI or assistant surface contains a write primitive", () => {
  const found = [];
  for (const f of FILES) {
    const body = code(f.text);
    for (const primitive of WRITE_PRIMITIVES) {
      if (primitive.re.test(body)) found.push(`${f.path}: ${primitive.name}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    "the assistant surface acquired a write path. Assistant output is never authority: a governed "
      + "fact is created by a human-driven governed command, not by the surface that suggested it.",
  );
});

test("the AI surface imports no write-capable symbol from firebase-admin/firestore", () => {
  const ALLOWED = new Set(["getFirestore", "Firestore"]);
  for (const f of FILES) {
    for (const m of code(f.text).matchAll(/import\s*\{([^}]*)\}\s*from\s*["']firebase-admin\/firestore["']/g)) {
      for (const raw of m[1].split(",")) {
        const symbol = raw.replace(/\btype\b/, "").trim();
        if (!symbol) continue;
        assert.ok(
          ALLOWED.has(symbol),
          `${f.path} imports "${symbol}" from firebase-admin/firestore; only a read handle is permitted here`,
        );
      }
    }
  }
});

// --- 4. the callable surface is exactly what is known --------------------------------------------

test("the AI surface exposes exactly the callables it is known to expose", () => {
  const callables = [];
  for (const f of FILES) {
    for (const m of code(f.text).matchAll(/export const (\w+)\s*=\s*onCall/g)) callables.push(m[1]);
  }
  assert.deepEqual(
    callables.sort(),
    ["getWorkOrderReadinessContext", "interpretWorkOrderReadinessContext"],
    "a new callable appeared on the AI surface. Every transport out of this boundary needs its own "
      + "governed authorization review; it does not inherit one from the module it lives in.",
  );
});

// --- 5. the behavioural limit: no governed capability, no data -----------------------------------

const WORK_ORDER = Object.freeze({
  woNumber: "WO-2026-000873",
  status: "DISPATCHED",
  type: "REPAIR",
  priority: "P2",
  assignedTechId: "tech-1",
  customerId: "customer-1",
  inventorySnapshot: [
    { partId: "part-1", name: "Scraper Blade Kit", sku: "X49463-3", qtyPlanned: 2, qtyUsed: 0 },
  ],
});

function probe(decisions, role = "admin") {
  const reads = { balances: 0, reservations: 0, reorders: 0 };
  return {
    reads,
    loadCaller: async () => ({ role, technicianId: "tech-1" }),
    loadWorkOrder: async () => ({ ...WORK_ORDER }),
    resolveCapabilityDecisions: async () => decisions,
    loadBalances: async () => { reads.balances += 1; return [{ partId: "part-1", available: { state: "KNOWN", value: 9 }, onHand: { state: "KNOWN", value: 9 }, reserved: { state: "KNOWN", value: 0 }, onOrder: { state: "KNOWN", value: 0 }, byLocation: [] }]; },
    loadReservationRows: async () => { reads.reservations += 1; return []; },
    loadReorderRows: async () => { reads.reorders += 1; return [{ partId: "part-1", status: "PURCHASING_IN_PROGRESS" }]; },
  };
}

test("an ADMIN with no governed capability retrieves nothing -- the role string is not an input", async () => {
  const deps = probe({});
  const result = await assembleWorkOrderReadinessContext({ principalUid: "u1", workOrderId: "wo-1" }, deps);

  assert.deepEqual(result.capabilities, {
    warehouse: false,
    truckInventory: false,
    purchasing: false,
    requestReorder: false,
  });
  // AUTHORIZATION BEFORE RETRIEVAL. Not "retrieved then filtered": the sources were never read, so
  // a denied fact never existed in the process and could never reach a prompt, a log or a cache.
  assert.deepEqual(deps.reads, { balances: 0, reservations: 0, reorders: 0 });
  assert.deepEqual(result.plannedParts[0].warehouse, { status: "UNAVAILABLE" });
  assert.deepEqual(result.plannedParts[0].procurement, { status: "NONE" });
});

test("each dimension is gated by its OWN governed capability, independently", async () => {
  const inventoryOnly = probe({ "inventory.balance.read": true });
  const a = await assembleWorkOrderReadinessContext({ principalUid: "u1", workOrderId: "wo-1" }, inventoryOnly);
  assert.equal(a.capabilities.warehouse, true);
  assert.equal(a.capabilities.purchasing, false);
  assert.equal(a.capabilities.requestReorder, false);
  assert.equal(inventoryOnly.reads.reorders, 0, "procurement was denied, so its source must not be read");
  assert.ok(a.limitations.includes("PROCUREMENT_READ_NOT_AUTHORIZED"));

  const procurementOnly = probe({ [PROCUREMENT_EVIDENCE_READ_CAPABILITY]: true });
  const b = await assembleWorkOrderReadinessContext({ principalUid: "u1", workOrderId: "wo-1" }, procurementOnly);
  assert.equal(b.capabilities.warehouse, false);
  assert.equal(b.capabilities.purchasing, true);
  assert.equal(b.capabilities.requestReorder, false, "reading the queue is not permission to create");
  assert.equal(procurementOnly.reads.balances, 0, "inventory was denied, so its source must not be read");
  assert.deepEqual(b.plannedParts[0].procurement, { status: "PENDING" });
});

test("reorder eligibility is a suggestion gate resolved from its own create capability", async () => {
  // Reading the reorder queue and being eligible to raise a request are different authorities, and
  // an assistant that conflated them would PROPOSE a write the principal cannot perform.
  const deps = probe({
    [PROCUREMENT_EVIDENCE_READ_CAPABILITY]: true,
    [REORDER_REQUEST_ELIGIBILITY_CAPABILITY]: true,
  });
  const result = await assembleWorkOrderReadinessContext({ principalUid: "u1", workOrderId: "wo-1" }, deps);
  assert.equal(result.capabilities.requestReorder, true);
  // It remains a suggestion: the context carries no writer and no command reference of any kind.
  assert.equal(typeof result.capabilities.requestReorder, "boolean");
  assert.doesNotMatch(JSON.stringify(result), /createReorderRequest|commandId|writeToken/);
});

test("a capability resolver failure denies everything rather than falling back to the role", async () => {
  const reads = { balances: 0, reservations: 0, reorders: 0 };
  const result = await assembleWorkOrderReadinessContext({ principalUid: "u1", workOrderId: "wo-1" }, {
    loadCaller: async () => ({ role: "admin", technicianId: null }),
    loadWorkOrder: async () => ({ ...WORK_ORDER }),
    resolveCapabilityDecisions: async () => { throw new Error("access feed unavailable"); },
    loadBalances: async () => { reads.balances += 1; return []; },
    loadReservationRows: async () => { reads.reservations += 1; return []; },
    loadReorderRows: async () => { reads.reorders += 1; return []; },
  });
  assert.deepEqual(result.capabilities, {
    warehouse: false, truckInventory: false, purchasing: false, requestReorder: false,
  });
  assert.deepEqual(reads, { balances: 0, reservations: 0, reorders: 0 });
});

// --- what actually leaves the EOS boundary -------------------------------------------------------

test("a denied dimension contributes nothing to what is sent to the model", async () => {
  const deps = probe({ "inventory.balance.read": true });
  const context = await assembleWorkOrderReadinessContext({ principalUid: "u1", workOrderId: "wo-1" }, deps);
  const envelope = JSON.stringify(buildWorkOrderInterpretationInput(context));

  // The procurement source was never read, so no procurement STATE can be described -- only the
  // absence, which is a fact about EOS rather than about a record the principal may not see.
  assert.match(envelope, /procurement none/);
  assert.doesNotMatch(envelope, /PURCHASING_IN_PROGRESS|pending|ordered|received/i);
  // And no identifier, customer or internal key crosses the boundary.
  for (const secret of ["part-1", "customer-1", "tech-1", "wo-1"]) {
    assert.doesNotMatch(envelope, new RegExp(secret));
  }
});
