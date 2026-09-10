// ADR-015 BOUNDARY GATES for the assistant's DASHBOARD business-data seam, PLUS the authority-source
// correction from owner review: the assistant must use the SAME effective operational authority model
// (business + functional + legacy compatibility Role, intersected with active capabilities) that the
// rest of EOS already uses for Work Orders/Inventory/Purchasing/Sales -- never the Postgres policy
// store's stored Role, which today governs Administration only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryAssistantBusinessDataReader } from "../lib/assistant/inMemoryAssistantBusinessDataReader.js";
import { buildDashboardTools } from "../lib/assistant/dashboardTools.js";
import { AssistantToolRegistry } from "../lib/assistant/assistantToolRegistry.js";
import { resolveAssistantFirestoreClient, FirestoreAssistantAdapter } from "../lib/assistant/firestoreAssistantAdapters.js";
import { resolveAssistantOperationalAuthoritySource } from "../lib/assistant/assistantOperationalAuthoritySource.js";
import {
  handleAssistantHttpRequest,
  assistantRoleResolver,
  ACTIVE_ASSISTANT_CAPABILITIES,
} from "../lib/assistant/assistantRoute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSISTANT_SRC_DIR = path.join(__dirname, "..", "src", "assistant");

// Files this task deliberately puts BELOW the ADR-015 line. Every other file in src/assistant must
// pass gates 1-2.
const BELOW_THE_LINE = new Set(["firestoreAssistantAdapters.ts"]);

function assistantSourceFiles() {
  return readdirSync(ASSISTANT_SRC_DIR)
    .filter((f) => f.endsWith(".ts") && !BELOW_THE_LINE.has(f))
    .map((f) => path.join(ASSISTANT_SRC_DIR, f));
}

test("gate 1: no above-line assistant file imports firebase-admin", () => {
  for (const file of assistantSourceFiles()) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /from\s+["']firebase-admin/, `${path.basename(file)} imports firebase-admin`);
  }
});

test("gate 2: no above-line assistant file names a Firestore collection", () => {
  const COLLECTION_NAMES = ["workOrders", "reorderRequests", "performanceGoals", "accounts"];
  for (const file of assistantSourceFiles()) {
    const src = readFileSync(file, "utf8");
    for (const name of COLLECTION_NAMES) {
      assert.ok(!src.includes(`"${name}"`) && !src.includes(`'${name}'`), `${path.basename(file)} names collection "${name}"`);
    }
  }
});

test("gate 3: dashboard tools depend only on AssistantBusinessDataReader (no firebase-admin, no Firestore import)", () => {
  const src = readFileSync(path.join(ASSISTANT_SRC_DIR, "dashboardTools.ts"), "utf8");
  assert.doesNotMatch(src, /from\s+["']firebase-admin/);
  assert.doesNotMatch(src, /from\s+["'][^"']*firestore[^"']*["']/i);
});

test("gate 4: POST /assistant/ask is exercisable end-to-end with the in-memory reader and a fake authority source, no GCP credential", async () => {
  const reader = new InMemoryAssistantBusinessDataReader();
  const scope = { tenantId: "tenant-1", principalUid: "principal-1" };
  reader.seed(scope, { serviceAttention: { pastDueCount: 3, schedulingConflictCount: 1 } });

  const registry = new AssistantToolRegistry();
  for (const tool of buildDashboardTools(reader)) registry.register(tool);

  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(),
      businessDataReaderConfigured: true,
      operationalAuthoritySource: fakeOperationalAuthoritySource({
        "tenant-1:principal-1": { businessRoleIds: ["fieldManager"], functionalRoleIds: [], compatibilityRoleId: null },
      }),
    },
    dashboardRequest("What needs attention right now?"),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.status, "ANSWERED");
  assert.ok(body.executedToolIds.includes("dashboard.serviceAttention"));
});

test("gate 5: a client-asserted tenant that is not a real membership is refused, not adopted", async () => {
  const registry = new AssistantToolRegistry();
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: null,
      businessDataReaderConfigured: false,
      operationalAuthoritySource: null,
    },
    dashboardRequest("hi", { "x-eos-tenant": "tenant-belonging-to-someone-else" }),
  );
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.body).code, "TENANT_NOT_A_MEMBERSHIP");
});

test("gate 5b: a client-supplied companyId that disagrees with the verified actor is refused", async () => {
  const registry = new AssistantToolRegistry();
  registry.register(dashboardToolStub("dashboard.serviceAttention", ["workOrder.transition"], () => fail("must not execute")));
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(() => fail("must not be called")),
      businessDataReaderConfigured: true,
      operationalAuthoritySource: fakeOperationalAuthoritySource({
        "tenant-1:principal-1": { businessRoleIds: ["fieldManager"], functionalRoleIds: [], compatibilityRoleId: null },
      }),
    },
    dashboardRequest("hi", {}, { companyId: "some-other-tenant" }),
  );
  assert.equal(response.status, 400);
});

test("gate 6: an unsupported/unregistered assistant tool never executes -- NO_PERMITTED_DATA, not a crash", async () => {
  const registry = new AssistantToolRegistry(); // nothing registered
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(() => fail("must not be called")),
      businessDataReaderConfigured: true,
      operationalAuthoritySource: fakeOperationalAuthoritySource({
        "tenant-1:principal-1": { businessRoleIds: ["fieldManager"], functionalRoleIds: [], compatibilityRoleId: null },
      }),
    },
    dashboardRequest("hi"),
  );
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, "NO_PERMITTED_DATA");
  assert.deepEqual(body.executedToolIds, []);
});

test("gate 7: the Firestore adapter has no write/update/delete method", () => {
  const adapter = new FirestoreAssistantAdapter({ async queryTenantScoped() { return []; } });
  const writeLike = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))
    .filter((m) => /^(write|set|update|delete|create|mutate)/i.test(m));
  assert.deepEqual(writeLike, []);
});

test("gate 8: the injected Firestore client interface has no generic arbitrary-path/collection read", () => {
  const src = readFileSync(path.join(ASSISTANT_SRC_DIR, "firestoreAssistantAdapters.ts"), "utf8");
  assert.doesNotMatch(src, /readDocument\s*\(/);
  assert.doesNotMatch(src, /getCollection\s*\(/);
  assert.doesNotMatch(src, /\breadPath\s*\(/);
});

test("gate 9: business-data credential absence fails explicitly -- resolveAssistantFirestoreClient returns null, never a live client", () => {
  assert.equal(resolveAssistantFirestoreClient(process.env), null);
});

test("gate 9b: the HTTP route refuses a DASHBOARD request explicitly when no business data reader is configured", async () => {
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry: new AssistantToolRegistry(),
      provider: null,
      businessDataReaderConfigured: false,
      operationalAuthoritySource: fakeOperationalAuthoritySource({}),
    },
    dashboardRequest("hi"),
  );
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(response.body).code, "ASSISTANT_DATA_SOURCE_NOT_CONFIGURED");
});

test("gate 9c: the operational authority source absence ALSO fails explicitly -- resolveAssistantOperationalAuthoritySource returns null today", () => {
  assert.equal(resolveAssistantOperationalAuthoritySource(process.env), null);
});

test("gate 9d: the HTTP route refuses a DASHBOARD request explicitly when no operational authority source is configured, even with a reader present", async () => {
  const registry = new AssistantToolRegistry();
  registry.register(dashboardToolStub("dashboard.serviceAttention", ["workOrder.transition"], () => fail("must not execute -- authority source unconfigured")));
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(() => fail("must not be called")),
      businessDataReaderConfigured: true, // the reader IS configured
      operationalAuthoritySource: null,   // the authority source is NOT
    },
    dashboardRequest("hi"),
  );
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(response.body).code, "ASSISTANT_AUTHORITY_SOURCE_NOT_CONFIGURED");
});

test("gate 10: /assistant/ask does not intercept /admin/policy or /health paths", async () => {
  const registry = new AssistantToolRegistry();
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1" }),
      verifyToken: async () => fail("must not be called"),
      registry,
      provider: null,
      businessDataReaderConfigured: false,
      operationalAuthoritySource: null,
    },
    { method: "POST", url: "/admin/policy", headers: {}, body: "{}" },
  );
  assert.equal(response, null, "the assistant handler must yield to any path it does not own");
});

// ════════════════════ owner-review correction: A, B, C, D ════════════════════

test("11a: a principal with a PERMISSIVE Postgres stored Role but NO current operational authority cannot retrieve Dashboard business data", async () => {
  const reader = new InMemoryAssistantBusinessDataReader();
  reader.seed({ tenantId: "tenant-1", principalUid: "principal-1" }, { serviceAttention: { pastDueCount: 9, schedulingConflictCount: 9 } });
  const registry = new AssistantToolRegistry();
  for (const tool of buildDashboardTools(reader)) registry.register(tool);

  // The Postgres policy store says this principal holds "admin" -- the most permissive Postgres Role
  // there is. If it were read as business authority, every dashboard tool would be ALLOW.
  const policyReader = fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1", postgresRoleKeys: ["admin"] });

  const response = await handleAssistantHttpRequest(
    {
      policyReader,
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(() => fail("must not be called -- nothing should be permitted")),
      businessDataReaderConfigured: true,
      // The ONE legitimate operational authority source resolves this principal to NOTHING -- no
      // Role at all -- which is the honest state until it is actually bound.
      operationalAuthoritySource: fakeOperationalAuthoritySource({
        "tenant-1:principal-1": { businessRoleIds: [], functionalRoleIds: [], compatibilityRoleId: null },
      }),
    },
    dashboardRequest("What needs attention right now?"),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, "NO_PERMITTED_DATA", "the permissive Postgres Role must grant nothing");
  assert.deepEqual(body.executedToolIds, []);
});

test("11b: a Dashboard tool decision follows the existing effective business/functional/compatibility authority model", async () => {
  const reader = new InMemoryAssistantBusinessDataReader();
  reader.seed({ tenantId: "tenant-1", principalUid: "principal-1" }, { reorderQueue: [{ id: "r1", partName: "Filter", requestedQty: 2 }] });
  const registry = new AssistantToolRegistry();
  for (const tool of buildDashboardTools(reader)) registry.register(tool);

  // "purchasingManager" is a real business Role (governedBusinessRoles.ts) that holds
  // reorder.request.read.queue. It is supplied ONLY through the operational authority source, never
  // through the Postgres reader -- and the Postgres reader here holds no matching Role at all, to
  // prove the two are genuinely independent.
  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1", postgresRoleKeys: [] }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(),
      businessDataReaderConfigured: true,
      operationalAuthoritySource: fakeOperationalAuthoritySource({
        "tenant-1:principal-1": { businessRoleIds: ["purchasingManager"], functionalRoleIds: [], compatibilityRoleId: null },
      }),
    },
    dashboardRequest("What is waiting in the reorder queue?"),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, "ANSWERED");
  assert.ok(body.executedToolIds.includes("dashboard.reorderQueue"));
});

test("11c: changing only a Postgres stored Object/Field permission cannot widen Dashboard business-data access today", async () => {
  const reader = new InMemoryAssistantBusinessDataReader();
  reader.seed({ tenantId: "tenant-1", principalUid: "principal-1" }, { serviceAttention: { pastDueCount: 1, schedulingConflictCount: 0 } });
  const registry = new AssistantToolRegistry();
  for (const tool of buildDashboardTools(reader)) registry.register(tool);

  const authoritySource = fakeOperationalAuthoritySource({
    "tenant-1:principal-1": { businessRoleIds: [], functionalRoleIds: [], compatibilityRoleId: null },
  });

  const narrowPolicyReader = fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1", postgresRoleKeys: [] });
  // A Postgres reader that grants an Object/Field permission a "widened" configuration might record --
  // Dashboard authorization must not even ask this reader for object/field data, so this can only
  // matter if something regresses and starts reading it.
  const widenedPolicyReader = fakePolicyReader({
    principalId: "principal-1",
    tenantId: "tenant-1",
    postgresRoleKeys: [],
    objectPermissions: [{ tenantId: "tenant-1", roleId: "any", objectKey: "workOrder", canRead: true }],
  });

  const outcomes = await Promise.all(
    [narrowPolicyReader, widenedPolicyReader].map((policyReader) =>
      handleAssistantHttpRequest(
        {
          policyReader,
          verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
          registry,
          provider: fakeProvider(),
          businessDataReaderConfigured: true,
          operationalAuthoritySource: authoritySource,
        },
        dashboardRequest("What needs attention right now?"),
      ).then((r) => JSON.parse(r.body)),
    ),
  );

  assert.equal(outcomes[0].status, outcomes[1].status, "an object/field permission change alone must not change the outcome");
  assert.deepEqual(outcomes[0].executedToolIds, outcomes[1].executedToolIds);
  assert.equal(outcomes[0].status, "NO_PERMITTED_DATA");
});

test("11d: a denied business-data tool performs ZERO AssistantBusinessDataReader calls", async () => {
  let readerCalls = 0;
  const countingReader = {
    async getServiceAttentionSummary() { readerCalls++; return { pastDueCount: 0, schedulingConflictCount: 0 }; },
    async getReorderQueuePreview() { readerCalls++; return []; },
    async getWorkOrdersByStatus() { readerCalls++; return []; },
    async getMyPerformanceGoals() { readerCalls++; return []; },
    async getAccountPortfolioSummary() { readerCalls++; return { total: 0, byStatus: {} }; },
  };
  const registry = new AssistantToolRegistry();
  for (const tool of buildDashboardTools(countingReader)) registry.register(tool);

  const response = await handleAssistantHttpRequest(
    {
      policyReader: fakePolicyReader({ principalId: "principal-1", tenantId: "tenant-1", postgresRoleKeys: ["admin"] }),
      verifyToken: async () => ({ externalSubject: "fb-uid-1", identityProvider: "firebase" }),
      registry,
      provider: fakeProvider(() => fail("must not be called")),
      businessDataReaderConfigured: true,
      // No operational Role at all -- every dashboard tool must be DENY.
      operationalAuthoritySource: fakeOperationalAuthoritySource({
        "tenant-1:principal-1": { businessRoleIds: [], functionalRoleIds: [], compatibilityRoleId: null },
      }),
    },
    dashboardRequest("What needs attention right now?"),
  );

  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).status, "NO_PERMITTED_DATA");
  assert.equal(readerCalls, 0, "a denied tool must never reach the business data reader");
});

test("assistantRoleResolver + ACTIVE_ASSISTANT_CAPABILITIES resolve a known operational Role to a non-empty set", () => {
  const perms = assistantRoleResolver.permissionsForRole("fieldManager");
  assert.ok(perms.length > 0);
  assert.ok(ACTIVE_ASSISTANT_CAPABILITIES.size > 0);
});

// ════════════════════ fixtures ════════════════════

function fail(message) {
  throw new Error(message);
}

function fakeProvider(onRespond) {
  return {
    metadata: { provider: "fake", model: "fake" },
    async respond() {
      if (onRespond) onRespond();
      return {
        text: "answer",
        usage: { inputTokens: 1, outputTokens: 1 },
        metadata: { provider: "fake", model: "fake" },
        latencyMs: 1,
        truncated: false,
      };
    },
    async health() {
      return { healthy: true, provider: "fake", checkedAtMs: Date.now() };
    },
  };
}

function dashboardToolStub(id, requires, onExecute) {
  return {
    id,
    surfaces: ["DASHBOARD"],
    description: "test stub",
    requires,
    deniedMessage: "denied",
    async execute() {
      onExecute();
      return { toolId: id, data: {}, recordsAccessed: [] };
    },
  };
}

function dashboardRequest(question, extraHeaders = {}, extraContext = {}) {
  return {
    method: "POST",
    url: "/assistant/ask",
    headers: { authorization: "Bearer test-token", ...extraHeaders },
    body: JSON.stringify({
      context: {
        route: "/dashboard",
        surface: "DASHBOARD",
        record: null,
        subView: null,
        question,
        conversationId: "conv-1",
        history: [],
        ...extraContext,
      },
    }),
  };
}

/** The ONLY permitted source of operational Role ids -- keyed by "tenantId:principalUid". */
function fakeOperationalAuthoritySource(byScope) {
  return {
    async resolveOperationalRoleIds({ tenantId, principalUid }) {
      return (
        byScope[`${tenantId}:${principalUid}`] ?? { businessRoleIds: [], functionalRoleIds: [], compatibilityRoleId: null }
      );
    },
  };
}

/**
 * The Postgres admin-policy reader. `postgresRoleKeys` is deliberately named to make the boundary
 * test's point legible: this is the ADMINISTRATION policy Role, and it must never flow into Dashboard
 * business-data authorization.
 */
function fakePolicyReader({ principalId, tenantId, postgresRoleKeys = [], objectPermissions = [] }) {
  const roleRecords = postgresRoleKeys.map((key, i) => ({ id: `role-${i}`, tenantId, key }));
  const membership = { principalId, tenantId, status: "active" };
  const assignments = roleRecords.map((r) => ({
    id: `assignment-${r.id}`,
    principalId,
    roleId: r.id,
    tenantId,
    status: "active",
    accessVersionAtGrant: 1,
  }));
  return {
    async getPrincipalBySubject() {
      return { id: principalId, status: "active" };
    },
    async listMembershipsForPrincipal(pid) {
      return pid === principalId ? [membership] : [];
    },
    async getTenant(tid) {
      return tid === tenantId ? { id: tenantId, status: "active" } : null;
    },
    async listRoles(tid) {
      return tid === tenantId ? roleRecords : [];
    },
    async getAccessVersion() {
      return { accessVersion: 1 };
    },
    async listObjects() {
      return [];
    },
    async listObjectPermissions() {
      return objectPermissions;
    },
    async listFieldOverrides() {
      return [];
    },
    async listAssignmentsForPrincipal(tid, pid) {
      return tid === tenantId && pid === principalId ? assignments : [];
    },
  };
}
