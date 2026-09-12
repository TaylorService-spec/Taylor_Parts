// P1B R2 — `Part.controlType` is IMMUTABLE after creation.
// Run: node --test test/partControlTypeImmutable.test.mjs   (prerequisite: npm run build)
//
// ════════════════════ WHAT THIS SUITE IS EVIDENCE FOR ════════════════════
//
// A Movement's `tracking_mode` is historical EVIDENCE of how a quantity was actually controlled
// when it moved. `Part.controlType` is POLICY for FUTURE operations. If controlType could be
// changed, every past movement would silently be re-read under a policy it was never recorded
// under — a STANDARD receipt becoming a serial-tracked receipt with no serials.
//
// The rule implemented is the BLANKET one: any change refuses. NOT "refuse only when history
// exists" — answering that needs a ledger query this command deliberately does not make (it would
// grow the Firebase dependency the exit ratchet is shrinking, and during the Postgres cutover
// "no Firestore history" does not mean "no history"). The last test in this file is a mechanical
// guard that no such query was smuggled in.
//
// NO EMULATOR. `updatePart`'s Firestore surface is narrow — a capability read, one audit-doc read
// for idempotency, one part read, and staged writes — so a transaction-faithful in-memory double
// (the equipmentInstallCommand.test.mjs / equipmentCompatibilityCommands.test.mjs precedent)
// exercises the whole refusal path deterministically. Writes are BUFFERED and applied only when
// the transaction body returns, so "nothing was written" is a real assertion, not a guess.

// A dummy emulator host forces firebase-admin's mock credentials. Nothing here ever performs an
// RPC: the audit writer builds a real DocumentReference (local, no network) which the double
// below accepts alongside its own refs, and every read/write goes through the double.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:65535";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import admin from "firebase-admin";

if (admin.apps.length === 0) admin.initializeApp({ projectId: "p1b-control-type-immutable" });

const {
  createPart,
  updatePart,
  assertControlTypeImmutable,
  ControlTypeImmutableError,
  InvalidInputError,
} = await import("../lib/partMaster/partMasterCommands.js");
const { CONTROL_TYPES } = await import("../lib/partMaster/types.js");
const { mapError } = await import("../lib/partMaster/partMasterCallables.js");

// ── The double. Collection/doc refs carry their own coordinates; a REAL DocumentReference (the
// one the audit writer builds) is read through `.parent.id` / `.id`, so both work. ─────────────
const ACTOR = "actor-p1b-a";
const ROLES = Object.freeze({
  pmFull: {
    id: "pmFull",
    name: "Part Master (test)",
    description: "test-only",
    permissions: ["inventory.catalog.manage", "inventory.catalog.activate"],
  },
});

function makeDb() {
  const store = {
    parts: {},
    auditEvents: {},
    users: { [ACTOR]: { accessVersion: 1 } },
    roleAssignments: {
      "assign-1": {
        id: "assign-1",
        principalUid: ACTOR,
        roleId: "pmFull",
        scope: { type: "global" },
        grantedBy: "test-fixture",
        grantedAt: { toMillis: () => 0 },
        status: "active",
        accessVersionAtGrant: 1,
      },
    },
  };
  const coords = (ref) => ({ c: ref.__c ?? ref.parent?.id, id: ref.__id ?? ref.id });
  const snapFor = (c, id) => {
    const data = store[c]?.[id];
    return { exists: data !== undefined, id, data: () => data };
  };
  const query = (name, clauses) => ({
    where: (field, op, value) => query(name, [...clauses, { field, op, value }]),
    get: async () => {
      const docs = Object.entries(store[name] ?? {})
        .filter(([, row]) => clauses.every(({ field, op, value }) => op === "==" && row[field] === value))
        .map(([id, row]) => ({ id, data: () => row }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const db = {
    collection: (name) => ({
      doc: (id) => ({ __c: name, __id: id, id, get: async () => snapFor(name, id) }),
      where: (f, o, v) => query(name, [{ field: f, op: o, value: v }]),
    }),
    runTransaction: async (fn) => {
      const staged = [];
      const txn = {
        get: async (ref) => {
          const { c, id } = coords(ref);
          return snapFor(c, id);
        },
        create: (ref, data) => {
          const { c, id } = coords(ref);
          if (store[c]?.[id] !== undefined) throw new Error("ALREADY_EXISTS");
          staged.push({ c, id, data });
        },
        set: (ref, data) => {
          const { c, id } = coords(ref);
          staged.push({ c, id, data });
        },
      };
      const result = await fn(txn); // a throw here discards `staged` — nothing commits
      for (const { c, id, data } of staged) {
        store[c] = store[c] ?? {};
        store[c][id] = data;
      }
      return result;
    },
  };
  return { db, store };
}

let seq = 0;
const nextKey = (p) => `${p}-key-000000${(seq += 1)}`;
const DEPS_FOR = (db) => ({ db, roles: ROLES, now: () => new Date(1750000000000) });

const partInput = (partId, controlType, extra = {}) => ({
  partId,
  internalPartNumber: partId,
  name: "Test Part",
  status: "DRAFT",
  stockingUnit: "EACH",
  controlType,
  stockingClass: "STOCKED",
  ...extra,
});

async function seeded(controlType = "STANDARD", partId = "PRT-1001") {
  const { db, store } = makeDb();
  const created = await createPart(
    { actorUid: ACTOR, idempotencyKey: nextKey("create"), part: partInput(partId, controlType) },
    DEPS_FOR(db),
  );
  assert.deepEqual(created, { outcome: "applied", version: 1 });
  assert.equal(store.parts[partId].controlType, controlType);
  return { db, store, partId };
}

// ── 1. Create-time selection still works exactly as today ───────────────────────────────────────
test("create accepts every governed controlType — create-time selection is unchanged", async () => {
  for (const controlType of CONTROL_TYPES) {
    const { store, partId } = await seeded(controlType, `PRT-C-${controlType}`);
    assert.equal(store.parts[partId].controlType, controlType);
    assert.equal(store.parts[partId].version, 1);
  }
});

// ── 2. Ordinary updates that preserve controlType pass ──────────────────────────────────────────
test("an ordinary update that RE-SENDS the stored controlType applies", async () => {
  const { db, store, partId } = await seeded("SERIALIZED");
  const r = await updatePart(
    {
      actorUid: ACTOR,
      idempotencyKey: nextKey("update"),
      partId,
      expectedVersion: 1,
      changes: { name: "Renamed Part", controlType: "SERIALIZED" },
    },
    DEPS_FOR(db),
  );
  assert.deepEqual(r, { outcome: "applied", version: 2 });
  assert.equal(store.parts[partId].name, "Renamed Part");
  assert.equal(store.parts[partId].controlType, "SERIALIZED");
});

test("an update that OMITS controlType preserves the stored value", async () => {
  const { db, store, partId } = await seeded("LOT");
  const r = await updatePart(
    {
      actorUid: ACTOR,
      idempotencyKey: nextKey("update"),
      partId,
      expectedVersion: 1,
      changes: { name: "Only the name changed" },
    },
    DEPS_FOR(db),
  );
  assert.deepEqual(r, { outcome: "applied", version: 2 });
  assert.equal(store.parts[partId].controlType, "LOT", "omission must never reset or drop the policy");
  assert.equal(store.parts[partId].name, "Only the name changed");
});

// ── 3. A CHANGE refuses, and writes nothing ─────────────────────────────────────────────────────
test("an attempted controlType CHANGE refuses and stages no write", async () => {
  const { db, store, partId } = await seeded("STANDARD");
  await assert.rejects(
    updatePart(
      {
        actorUid: ACTOR,
        idempotencyKey: nextKey("update"),
        partId,
        expectedVersion: 1,
        changes: { controlType: "SERIALIZED" },
      },
      DEPS_FOR(db),
    ),
    (err) => {
      assert.ok(err instanceof ControlTypeImmutableError, `got ${err?.constructor?.name}: ${err?.message}`);
      assert.match(err.message, /immutable after part creation/);
      return true;
    },
  );
  assert.equal(store.parts[partId].controlType, "STANDARD");
  assert.equal(store.parts[partId].version, 1, "the refused update must not bump the version");
  assert.equal(Object.keys(store.auditEvents).length, 1, "only the create audit exists — no applied update audit");
});

test("the refusal holds in BOTH directions and for every other governed value", async () => {
  for (const from of CONTROL_TYPES) {
    for (const to of CONTROL_TYPES) {
      if (from === to) continue;
      const { db, partId } = await seeded(from, `PRT-X-${from}`);
      await assert.rejects(
        updatePart(
          { actorUid: ACTOR, idempotencyKey: nextKey("update"), partId, expectedVersion: 1, changes: { controlType: to } },
          DEPS_FOR(db),
        ),
        // A cross-field domain rule (e.g. SERVICE/whole-unit) may reject some pairs first; either
        // way the change never applies. What must NEVER happen is success.
        (err) => err instanceof ControlTypeImmutableError || err instanceof InvalidInputError,
        `${from} -> ${to} must refuse`,
      );
    }
  }
});

// ── 4. Same-value is idempotent, not a refusal ──────────────────────────────────────────────────
test("a same-value controlType update is idempotent — it does NOT refuse", async () => {
  const { db, store, partId } = await seeded("SERIALIZED_LOT");
  for (const expectedVersion of [1, 2]) {
    const r = await updatePart(
      {
        actorUid: ACTOR,
        idempotencyKey: nextKey("update"),
        partId,
        expectedVersion,
        changes: { controlType: "SERIALIZED_LOT" },
      },
      DEPS_FOR(db),
    );
    assert.deepEqual(r, { outcome: "applied", version: expectedVersion + 1 });
  }
  assert.equal(store.parts[partId].controlType, "SERIALIZED_LOT");
});

// ── 5. An unknown value still refuses through the EXISTING validation path ──────────────────────
test("an unknown controlType refuses through the existing domain validation, not as an immutability error", async () => {
  const { db, partId } = await seeded("STANDARD");
  await assert.rejects(
    updatePart(
      {
        actorUid: ACTOR,
        idempotencyKey: nextKey("update"),
        partId,
        expectedVersion: 1,
        changes: { controlType: "BATCH_TRACKED" },
      },
      DEPS_FOR(db),
    ),
    (err) => {
      assert.ok(err instanceof InvalidInputError, `got ${err?.constructor?.name}`);
      assert.ok(!(err instanceof ControlTypeImmutableError));
      assert.match(err.message, /controlType:INVALID_ENUM/);
      return true;
    },
  );
});

test("an unknown controlType is refused at CREATE by the same validation path", async () => {
  const { db } = makeDb();
  await assert.rejects(
    createPart(
      { actorUid: ACTOR, idempotencyKey: nextKey("create"), part: partInput("PRT-BAD", "BATCH_TRACKED") },
      DEPS_FOR(db),
    ),
    (err) => err instanceof InvalidInputError && /controlType:INVALID_ENUM/.test(err.message),
  );
});

// ── 6. The rule itself, pure ────────────────────────────────────────────────────────────────────
test("assertControlTypeImmutable: same value passes, any different value throws", () => {
  for (const ct of CONTROL_TYPES) assert.doesNotThrow(() => assertControlTypeImmutable(ct, ct));
  assert.throws(() => assertControlTypeImmutable("STANDARD", "LOT"), ControlTypeImmutableError);
  assert.throws(() => assertControlTypeImmutable("SERIALIZED", "STANDARD"), ControlTypeImmutableError);
});

// ── 7. The refusal crosses the callable boundary as a stable, non-leaky code ────────────────────
test("the callable taxonomy surfaces the refusal as failed-precondition, not internal", () => {
  const mapped = mapError(new ControlTypeImmutableError('controlType is immutable after part creation (stored "STANDARD", requested "LOT")'));
  assert.equal(mapped.code, "failed-precondition");
  assert.match(mapped.message, /control type cannot be changed/);
  assert.ok(!/STANDARD|LOT/.test(mapped.message), "the generic message must not leak stored state");
});

// ── 8. MECHANICAL: the decision is made without any inventory-history query ─────────────────────
test("partMasterCommands consults NO inventory ledger to decide — the blanket rule needs no history", () => {
  const source = readFileSync("src/partMaster/partMasterCommands.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const collection of ["inventory_transactions", "serialized_assets", "inventory_movements"]) {
    assert.ok(!source.includes(collection), `partMasterCommands must not query ${collection}`);
  }
});
