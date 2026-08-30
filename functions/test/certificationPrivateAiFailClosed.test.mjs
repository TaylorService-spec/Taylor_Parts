// CERTIFICATION PRIVATE-AI FAIL-CLOSED CONTRACT (deterministic half).
//
// Turns the private-AI governance promises into standing executable invariants against the seeded
// Certification World. The live half — the same questions asked of the deployed
// eos-platform-certification project — is scripts/certificationWorld/verifyPrivateAiFailClosed.mjs.
//
// THE POINT OF THIS SUITE: DATA PRESENT != AI AUTHORITY. It first proves that meaningful seeded
// operational data exists and can reach the interpretation assembler, and only then asserts that
// the eos-platform-certification posture still refuses — before provider resolution, before any
// governed read, with no interpretation, recommendation, or generated text of any kind.
//
// Four contracts, one file:
//   1. data exists but AI still fails closed        (world pinned, exact refusal, zero reads)
//   2. AI has no direct Firestore data authority    (Architecture A: no principal exists at all)
//   3. governed context is the only data entrance   (closed envelope vocabulary, no paths/creds)
//   4. fail-closed configuration                    (already held by aiWorkOrderReadinessContext
//      .test.mjs and aiOperationalProvider.test.mjs; the posture pin below is the piece that ties
//      those refusals to THIS project's registry entry)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assembleWorkOrderReadinessContext,
  interpretWorkOrderReadiness,
  runtimeSyntheticInterpretationPermitted,
} from "../lib/ai/workOrderReadinessContext.js";
import {
  ENVIRONMENT_ACTIVATION_REGISTRY,
  resolveSyntheticOperationalInterpretation,
} from "../lib/access/environmentCapabilityOverrides.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const L = (p) => pathToFileURL(join(REPO_ROOT, p)).href;

const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));

// ============================ THE GOVERNED EXPECTATION ============================
//
// These three numbers are the installed Certification World: what `certificationWorld.mjs verify`
// compares the live eos-platform-certification project against. They are pinned HERE, in a test,
// so that a change to the world is a conscious act that updates this file in the same PR — never a
// silent drift that the fail-closed proof keeps endorsing.
//
// UPDATED FOR v1.7.0 (2026-08-30). EOS Ownership Model v1 added deterministic ownership content to
// account and equipment records: no rows created, none deleted, so the count is STILL 1092 and the
// content is different. This file is what noticed -- it was the only check pinning a fingerprint,
// and it caught the drift that `verify` was reporting as COMPLETE.
//
// The dataset version moved with the content, and the fingerprint moved with the version, because
// every record carries its marker version and the marker is hashed:
//
//   1.6.0 + pre-ownership content   005ebb1b
//   1.6.0 + ownership content       ed95c91d   <- the drift this file detected
//   1.7.0 + ownership content       fcc38a5f   <- the governed authority now
//
// ed95c91d was never a resting state: it is what the world hashed to for as long as content had
// changed and the version had not. Recording all three keeps that legible.
const CERT_PROJECT = "eos-platform-certification";
const EXPECTED_RECORD_COUNT = 1092;
const EXPECTED_FINGERPRINT = "fcc38a5f";
const EXPECTED_EMPLOYEES = 47;

const world = expectedRecords();

// ============================ CONTRACT 1 — DATA EXISTS, AI STILL FAILS CLOSED ===================

test("the repository defines the exact world the live verifier expects", () => {
  const fp = worldFingerprint(world.records);
  assert.equal(world.records.length, EXPECTED_RECORD_COUNT);
  assert.equal(fp.hash, EXPECTED_FINGERPRINT);
  assert.equal(world.records.filter((r) => r.collection === "employees").length, EXPECTED_EMPLOYEES);
});

test("the base world carries meaningful operational data, and no work_orders readiness source", () => {
  // The readiness assembler reads `work_orders` documents carrying an inventorySnapshot. The base
  // Certification World deliberately contains neither: its field-service load lives in
  // fieldops_jobs, which the assembler does not read. The work order's precondition — "a seeded
  // context source, IF the current world contains one" — therefore resolves to: it does not, and
  // the data-present proof below is built FROM seeded world entities instead. If a future world
  // version adds work_orders with planned parts, this test fails and the proof must be upgraded to
  // read them directly — that is this assertion's job.
  const collections = new Set(world.records.map((r) => r.collection));
  for (const expected of ["accounts", "employees", "parts", "equipment", "fieldops_jobs", "fieldops_technicians"]) {
    assert.ok(collections.has(expected), `world is missing ${expected}`);
  }
  assert.ok(!collections.has("work_orders"), "world now seeds work_orders — upgrade the data-present proof to use them");
  assert.ok(
    world.records.every((r) => !Array.isArray(r.data.inventorySnapshot)),
    "a seeded record carries an inventorySnapshot — upgrade the data-present proof to use it",
  );
});

/** A work order built from real seeded Certification World entities, and the read counters that
 *  prove whether the interpretation path ever touched them. */
function seededWorldDeps() {
  const parts = world.records.filter((r) => r.collection === "parts").slice(0, 2);
  assert.equal(parts.length, 2, "the seeded world must supply at least two parts");
  const account = world.records.find((r) => r.collection === "accounts");
  const calls = { loadCaller: 0, loadWorkOrder: 0, resolveAccess: 0, balances: 0, reservations: 0, reorders: 0 };
  const deps = {
    loadCaller: async () => { calls.loadCaller += 1; return { role: "dispatcher", technicianId: null }; },
    loadWorkOrder: async () => {
      calls.loadWorkOrder += 1;
      return {
        id: "cert-ai-probe-wo",
        woNumber: "WO-CERT-0001",
        status: "DISPATCHED",
        type: "REPAIR",
        priority: "P2",
        assignedTechId: null,
        customerId: account.id,
        inventorySnapshot: parts.map((p) => ({
          partId: p.id, name: p.data.name, sku: p.data.sku, qtyPlanned: 2, qtyUsed: 0,
        })),
      };
    },
    resolveInventoryBalanceAccess: async () => { calls.resolveAccess += 1; return true; },
    loadBalances: async () => {
      calls.balances += 1;
      return parts.map((p) => ({
        partId: p.id,
        onHand: { state: "KNOWN", value: 1 },
        reserved: { state: "KNOWN", value: 0 },
        available: { state: "KNOWN", value: 1 },
        onOrder: { state: "KNOWN", value: 0 },
        byLocation: [],
      }));
    },
    loadReservationRows: async () => { calls.reservations += 1; return []; },
    loadReorderRows: async () => { calls.reorders += 1; return []; },
  };
  return { deps, calls, parts };
}

test("seeded operational data assembles into a real interpretation context — the data is present", async () => {
  const { deps, parts } = seededWorldDeps();
  const context = await assembleWorkOrderReadinessContext(
    { principalUid: "cert-principal", workOrderId: "cert-ai-probe-wo" }, deps,
  );
  assert.equal(context.plannedParts.length, 2);
  assert.equal(context.plannedParts[0].name, parts[0].data.name);
  assert.equal(context.plannedParts[0].sku, parts[0].data.sku);
  assert.equal(context.subject.reference, "WO-CERT-0001");
});

test("with that data present, eos-platform-certification refuses before resolving a provider or reading anything", async () => {
  const { deps, calls } = seededWorldDeps();
  let providerResolved = 0;
  const providerCalls = [];

  const outcome = await interpretWorkOrderReadiness(
    { principalUid: "cert-principal", workOrderId: "cert-ai-probe-wo" },
    {
      context: deps,
      // The REAL registry decision for the REAL project, not a stubbed boolean.
      syntheticInterpretationPermitted: () =>
        resolveSyntheticOperationalInterpretation(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_PROJECT),
      resolveProvider: () => {
        providerResolved += 1;
        return { name: "spy", interpret: async (envelope) => { providerCalls.push(envelope); return {}; } };
      },
    },
  );

  // The exact governed policy result — deepEqual, so no extra field can ride along either.
  assert.deepEqual(outcome, { speak: false, origin: "EOS", reason: "INTERPRETATION_NOT_PERMITTED_HERE" });

  // No interpretation, no recommendation, no generated text of any kind.
  const serialized = JSON.stringify(outcome);
  for (const forbidden of ["interpretation", "recommend", "businessConsequence", "confidence"]) {
    assert.ok(!serialized.includes(forbidden), `refusal carries ${forbidden}`);
  }

  // Provider resolution is not reached; model invocation is not reached.
  assert.equal(providerResolved, 0, "the provider was resolved in a refused environment");
  assert.equal(providerCalls.length, 0, "the model was invoked in a refused environment");

  // No governed read occurs — the refusal precedes the data, which is why a caller cannot use this
  // path to learn anything about the world it was refused from. (And no write CAN occur: the
  // dependency surface is six reads; aiWorkOrderReadinessContext.test.mjs asserts that shape.)
  assert.deepEqual(calls, { loadCaller: 0, loadWorkOrder: 0, resolveAccess: 0, balances: 0, reservations: 0, reorders: 0 });
});

test("the FALSE posture is declared identically in the shipped snapshot, the canonical registry, and the runtime decision", () => {
  // privateAiSyntheticOperationalInterpretation MUST remain FALSE for eos-platform-certification
  // until the Owner ratifies otherwise. Flipping it is a governance decision that must consciously
  // update this test in the same PR.
  const snapshot = ENVIRONMENT_ACTIVATION_REGISTRY.environments
    .find((e) => e?.firebase?.projectId === CERT_PROJECT);
  assert.ok(snapshot, "eos-platform-certification is missing from the shipped snapshot");
  assert.equal(snapshot.role, "sandbox");
  assert.equal(snapshot.privateAiSyntheticOperationalInterpretation, false);

  const canonical = JSON.parse(readFileSync(join(REPO_ROOT, "config", "environments.json"), "utf8"))
    .environments.find((e) => e?.firebase?.projectId === CERT_PROJECT);
  assert.ok(canonical, "eos-platform-certification is missing from config/environments.json");
  assert.equal(canonical.privateAiSyntheticOperationalInterpretation, false);

  assert.equal(resolveSyntheticOperationalInterpretation(ENVIRONMENT_ACTIVATION_REGISTRY, CERT_PROJECT), false);

  // The exact decision the deployed runtime makes from its platform-set identity.
  const previous = { g: process.env.GCLOUD_PROJECT, gc: process.env.GOOGLE_CLOUD_PROJECT };
  try {
    process.env.GCLOUD_PROJECT = CERT_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    assert.equal(runtimeSyntheticInterpretationPermitted(), false);
  } finally {
    if (previous.g === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = previous.g;
    if (previous.gc === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = previous.gc;
  }
});

// ============================ CONTRACT 2 — NO AI FIRESTORE PRINCIPAL ============================
//
// Architecture classification: A — NO AI FIRESTORE PRINCIPAL EXISTS. The Keystone runtime is a
// separate service with no Firebase SDK in its dependency set at all; on the EOS side, the only
// module in the AI seam that touches Firestore is the trusted EOS Function that assembles the
// governed context under EOS authorization. The provider/transport path — the code that talks to
// the model — must have no Firestore client, no Admin SDK initialization, and no service-account
// credential requirement. That absence is asserted here so it cannot erode quietly.

const AI_SOURCE_DIR = join(REPO_ROOT, "functions", "src", "ai");

/** Files in the AI seam that legitimately read Firestore: EOS Functions assembling governed
 *  context under EOS authorization. Everything else in src/ai must be Firestore-free. */
const EOS_ASSEMBLER_FILES = new Set(["workOrderReadinessContext.ts"]);

const FIRESTORE_MARKERS = [
  "firebase-admin", "firebase-functions", "getFirestore", "initializeApp",
  "applicationDefault", "GOOGLE_APPLICATION_CREDENTIALS", "@google-cloud",
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("the operational AI path requires no Firestore client and no service-account credential", () => {
  const files = readdirSync(AI_SOURCE_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0, "no AI source was scanned");
  assert.ok(files.some((f) => EOS_ASSEMBLER_FILES.has(f)), "the assembler allowlist names a file that no longer exists");
  for (const file of files) {
    if (EOS_ASSEMBLER_FILES.has(file)) continue;
    const source = stripComments(readFileSync(join(AI_SOURCE_DIR, file), "utf8"));
    for (const marker of FIRESTORE_MARKERS) {
      assert.ok(!source.includes(marker), `${file} reaches ${marker} — the transport path must hold no data authority`);
    }
  }
});

test("provider configuration is gateway transport auth only — never a Firebase credential", () => {
  // The five KEYSTONE_* values authenticate the TRANSPORT (gateway key, tenant, Cloudflare Access
  // service token). None of them is, or can substitute for, a Firestore credential, and the
  // provider factory reads nothing else.
  const source = stripComments(readFileSync(join(AI_SOURCE_DIR, "operationalProvider.ts"), "utf8"))
    + stripComments(readFileSync(join(AI_SOURCE_DIR, "provider.ts"), "utf8"));
  const envReads = [...source.matchAll(/environment\.([A-Z][A-Z0-9_]+)|process\.env\.([A-Z][A-Z0-9_]+)/g)]
    .map((m) => m[1] ?? m[2]);
  for (const name of envReads) {
    assert.match(name, /^KEYSTONE_/, `provider path reads ${name} — only KEYSTONE_* transport config is permitted`);
  }
});

// ============================ CONTRACT 3 — THE ENVELOPE IS THE ONLY ENTRANCE ====================
//
// aiOperationalProvider.test.mjs already proves the POST body is exactly the envelope, that the
// envelope schema is enforced before any network call, and that unknown envelope/evidence/
// recommendation fields are refused (closed vocabulary). What remains HERE is the seeded-world
// half: when a real envelope is built from certification data, nothing in it can serve as a fetch
// instruction — no collection name, no document path, no credential name.

test("an envelope assembled from seeded certification data carries no collection name, path, or credential", async () => {
  const { deps } = seededWorldDeps();
  const sent = [];
  const outcome = await interpretWorkOrderReadiness(
    { principalUid: "cert-principal", workOrderId: "cert-ai-probe-wo" },
    {
      context: deps,
      // Permitted HERE so the envelope is actually built and inspectable — this models
      // demo-certworld, the one governed-synthetic environment. The refusal posture of
      // eos-platform-certification is Contract 1's subject, above.
      syntheticInterpretationPermitted: () => true,
      resolveProvider: () => ({
        name: "spy",
        interpret: async (envelope) => {
          sent.push(envelope);
          return {
            interpretation: "A planned part is below its outstanding quantity.",
            businessConsequence: "The job may be held.",
            confidence: "HIGH", confidenceBasis: "Grounded in E1.", evidenceRefs: ["E1"],
            recommendedActionId: null,
          };
        },
      }),
    },
  );
  assert.equal(outcome.speak, true, "the permitted environment should have produced a verified interpretation");
  assert.equal(sent.length, 1);

  const envelope = sent[0];
  // The closed vocabulary, exactly — the same set the transport enforces.
  assert.deepEqual(Object.keys(envelope).sort(), [
    "allowedRecommendation", "classification", "deterministicBusinessConsequence",
    "deterministicInterpretation", "domain", "evidence", "maxOutputTokens", "mode",
    "observedFact", "schemaVersion", "source", "subjectReference", "synthetic",
  ]);

  const serialized = JSON.stringify(envelope);
  for (const forbidden of [
    // Firestore collections the assembler itself read from — the join keys must not ride along.
    "work_orders", "inventory_transactions", "reorder_requests", "parts/", "accounts/", "employees/",
    // Document ids used to build the context.
    "cert-ai-probe-wo", "cert-principal", "CW-P-0000", "CW-P-0001",
    // Credential and configuration names.
    "GOOGLE_APPLICATION_CREDENTIALS", "KEYSTONE_GATEWAY", "KEYSTONE_ACCESS",
  ]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} crossed the model boundary`);
  }
});
