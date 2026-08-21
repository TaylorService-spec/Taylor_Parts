// Per-environment capability activation -- backend resolver tests
// (per-environment-capability-activation-spec.md, Owner-directed 2026-08-14).
//
// These lock the security-critical properties of the ONLY mechanism that lifts
// the sales/fulfillment/finance spine's blanket active:false DENY:
//   - production is NEVER activatable (role-keyed, ignores registry data);
//   - an unknown project fails closed;
//   - the eligible allow-list bounds what any environment can activate;
//   - the shipped runtime snapshot exactly matches the canonical registry;
//   - runtime resolution is driven by the trusted GCLOUD_PROJECT identity.
//
// Prerequisite: `npm run build` in functions/ first (imports compiled lib/).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  resolveCapabilityOverrides,
  resolveRuntimeCapabilityOverrides,
  __resetRuntimeCapabilityOverridesCacheForTest,
  SPINE_OVERRIDE_ELIGIBLE_IDS,
  ENVIRONMENT_ACTIVATION_REGISTRY,
} from "../lib/access/environmentCapabilityOverrides.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL_REGISTRY = JSON.parse(
  readFileSync(resolve(HERE, "../../config/environments.json"), "utf8"),
);

// 16 eligible ids as of Wave 7. Grew from the original 11: inventory.catalog.read (Wave 6 Owner
// Decision -- a governed trusted read the Parts experience needs), then workOrder.parts.plan,
// crm.activity.create and crm.activity.read (Wave 7 Owner-authorized sandbox activation, so the
// parts-planning and CRM Activity surfaces are exercisable at all rather than permanently denied).
// The historical SPINE_11 name is kept because the constant, not its name, is the authoritative
// list -- renaming it would churn every reference below for no behavioral gain.
const SPINE_11 = [
  "opportunity.write",
  "opportunity.read",
  "opportunity.createSalesOrder",
  "salesOrder.read",
  "salesOrder.write",
  "salesOrder.fulfill",
  "salesOrder.service",
  "finance.invoice.issue",
  "finance.payment.apply",
  "finance.adjustment.record",
  "finance.read",
  "finance.refund.record",
  "inventory.catalog.read",
  "workOrder.parts.plan",
  "crm.activity.create",
  "crm.activity.read",
  "fulfillment.coordinatedVisit.read",
  "inventory.serializedAsset.read",
  "inventory.location.display.read",
  "inventory.transfer.create",
  "inventory.transfer.dispatch",
  "inventory.transfer.receive",
  "inventory.transfer.cancel",
  "inventory.cycleCount.create",
  "inventory.cycleCount.submit",
  "inventory.cycleCount.reconcile",
  "inventory.cycleCount.cancel",
  // SCANNER PROMOTION 2026-08-20. The six capabilities the scanner program added, made eligible so
  // platform-sandbox can exercise put-away, pick, bin administration, returns intake and the lookup
  // reads at all. inventory.stock.receive is NOT here and needs no override -- it is not active:false.
  "inventory.catalog.alias.read",
  "inventory.balance.read",
  "inventory.location.bin.manage",
  "inventory.location.bin.read",
  "inventory.placement.record",
  "inventory.returns.intake",
];

const sorted = (set) => [...set].sort();

test("eligible allow-list is exactly the 33 eligible capability ids", () => {
  assert.deepEqual(sorted(SPINE_OVERRIDE_ELIGIBLE_IDS), [...SPINE_11].sort());
  assert.equal(SPINE_OVERRIDE_ELIGIBLE_IDS.size, 33);
});

test("sandbox project resolves the full spine override set", () => {
  const out = resolveCapabilityOverrides(CANONICAL_REGISTRY, "eos-platform-sandbox");
  assert.deepEqual(sorted(out), [...SPINE_11].sort());
});

test("production project resolves EMPTY (data: prod entry has no key)", () => {
  const out = resolveCapabilityOverrides(CANONICAL_REGISTRY, "taylor-parts");
  assert.equal(out.size, 0);
});

test("production role is role-keyed: EMPTY even when registry WRONGLY grants overrides", () => {
  // Adversarial fixture: a production entry that (incorrectly) carries the full
  // spine override list. The role-keyed code block must ignore the data entirely.
  const poisoned = {
    environments: [
      {
        id: "poisoned-prod",
        role: "production",
        firebase: { projectId: "taylor-parts" },
        capabilityActivationOverrides: [...SPINE_11],
      },
    ],
  };
  const out = resolveCapabilityOverrides(poisoned, "taylor-parts");
  assert.equal(out.size, 0, "production must never be activatable, even with poisoned data");
});

test("unknown project fails closed (EMPTY)", () => {
  assert.equal(resolveCapabilityOverrides(CANONICAL_REGISTRY, "not-a-real-project").size, 0);
});

test("missing / empty projectId fails closed (EMPTY)", () => {
  assert.equal(resolveCapabilityOverrides(CANONICAL_REGISTRY, null).size, 0);
  assert.equal(resolveCapabilityOverrides(CANONICAL_REGISTRY, undefined).size, 0);
  assert.equal(resolveCapabilityOverrides(CANONICAL_REGISTRY, "").size, 0);
});

test("malformed registry fails closed (EMPTY)", () => {
  assert.equal(resolveCapabilityOverrides(null, "eos-platform-sandbox").size, 0);
  assert.equal(resolveCapabilityOverrides({}, "eos-platform-sandbox").size, 0);
  assert.equal(resolveCapabilityOverrides({ environments: "x" }, "eos-platform-sandbox").size, 0);
});

test("eligible-set intersection filters an ineligible declared id", () => {
  const sneaky = {
    environments: [
      {
        id: "sneaky-sandbox",
        role: "sandbox",
        firebase: { projectId: "eos-sneaky" },
        // "admin.credentialReset.initiate" is a real active:false capability that
        // is deliberately NOT spine-eligible -- it must be filtered out.
        capabilityActivationOverrides: ["opportunity.write", "admin.credentialReset.initiate"],
      },
    ],
  };
  const out = resolveCapabilityOverrides(sneaky, "eos-sneaky");
  assert.deepEqual(sorted(out), ["opportunity.write"]);
});

test("shipped runtime snapshot matches the canonical registry projection", () => {
  // Drift guard: the embedded ENVIRONMENT_ACTIVATION_REGISTRY (which ships in the
  // Functions deploy bundle because config/environments.json does not) must agree
  // with the canonical registry on exactly the fields the resolver reads.
  const project = (env) => ({
    role: env.role,
    projectId: env.firebase?.projectId ?? null,
    overrides: Array.isArray(env.capabilityActivationOverrides)
      ? [...env.capabilityActivationOverrides].sort()
      : null,
  });
  const canonical = CANONICAL_REGISTRY.environments.map(project);
  const snapshot = ENVIRONMENT_ACTIVATION_REGISTRY.environments.map(project);
  assert.deepEqual(snapshot, canonical);
});

test("runtime resolution is driven by GCLOUD_PROJECT (sandbox -> full spine)", () => {
  const prev = process.env.GCLOUD_PROJECT;
  try {
    __resetRuntimeCapabilityOverridesCacheForTest();
    process.env.GCLOUD_PROJECT = "eos-platform-sandbox";
    assert.deepEqual(sorted(resolveRuntimeCapabilityOverrides()), [...SPINE_11].sort());
  } finally {
    if (prev === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = prev;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
});

test("runtime resolution for production project -> EMPTY", () => {
  const prev = process.env.GCLOUD_PROJECT;
  try {
    __resetRuntimeCapabilityOverridesCacheForTest();
    process.env.GCLOUD_PROJECT = "taylor-parts";
    assert.equal(resolveRuntimeCapabilityOverrides().size, 0);
  } finally {
    if (prev === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = prev;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
});

test("runtime resolution with no project identity -> EMPTY", () => {
  const prevG = process.env.GCLOUD_PROJECT;
  const prevGG = process.env.GOOGLE_CLOUD_PROJECT;
  try {
    __resetRuntimeCapabilityOverridesCacheForTest();
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    assert.equal(resolveRuntimeCapabilityOverrides().size, 0);
  } finally {
    if (prevG === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = prevG;
    if (prevGG === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = prevGG;
    __resetRuntimeCapabilityOverridesCacheForTest();
  }
});
