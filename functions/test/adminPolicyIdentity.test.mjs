// IDENTITY, TENANT RESOLUTION AND THE API'S SHAPE — proved without a database.
//
// The activation suite proves this subsystem OPERATES against PostgreSQL. This file proves the
// rules that must hold whatever the store is, and it runs in every lane rather than only where a
// database container exists — because the rules below are the ones whose violation is a security
// failure rather than a bug:
//
//   tenant is never taken from the request
//   an unknown or disabled principal gets no context at all
//   the operation list is CLOSED
//   nothing in the policy subsystem reaches Firestore
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { resolvePrincipalContext, PrincipalContextError } from "../lib/adminPolicy/principalContext.js";
import {
  ADMIN_MUTATION_OPERATIONS,
  ADMIN_READ_OPERATIONS,
  executeAdminOperation,
  isAdminOperation,
  isMutation,
} from "../lib/adminPolicy/adminPolicyApi.js";
import { handleAdminRequest } from "../lib/adminPolicy/adminPolicyHttp.js";
import { readServiceConfig, ServiceConfigError } from "../lib/eosApi/server.js";
import { redactConnectionString } from "../lib/adminPolicy/policyDatabase.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

/**
 * Two tenants, one principal in each, and one principal in both.
 *
 * Built directly through the repository rather than through the bootstrap, so this file proves the
 * RESOLUTION rules in isolation from how a tenant comes to exist.
 */
async function twoTenants() {
  const repo = new InMemoryPolicyRepository();
  const made = {};

  for (const [tenantId, key] of [[TENANT_A, "a"], [TENANT_B, "b"]]) {
    await repo.transact({ tenantId, uid: "setup" }, async (tx) => {
      await tx.createTenant({ key, name: key });
      const role = await tx.createRole({
        key: "admin", name: "Admin", description: null, origin: "SYSTEM", protected: true,
      });
      made[`${tenantId}:adminRole`] = role;
    });
  }

  const create = async (tenantId, subject, opts = {}) =>
    repo.transact({ tenantId, uid: "setup" }, async (tx) => {
      const principal = await tx.createPrincipal({
        externalSubject: subject, identityProvider: "firebase", status: opts.status,
      });
      await tx.createTenantMembership(principal.id, opts.membershipStatus);
      return principal;
    });

  const onlyA = await create(TENANT_A, "subject-a");
  const disabled = await create(TENANT_A, "subject-disabled", { status: "disabled" });
  const inactiveMember = await create(TENANT_A, "subject-inactive", { membershipStatus: "disabled" });

  // One human, two tenants — the ambiguity case.
  const both = await create(TENANT_A, "subject-both");
  await repo.transact({ tenantId: TENANT_B, uid: "setup" }, (tx) => tx.createTenantMembership(both.id));

  return { repo, onlyA, disabled, inactiveMember, both, made };
}

// ============================ tenant is not a request parameter ============================

test("a principal in ONE tenant resolves to it without stating anything", async () => {
  const { repo } = await twoTenants();
  const context = await resolvePrincipalContext(repo, { externalSubject: "subject-a" });
  assert.equal(context.tenantId, TENANT_A);
});

test("A STATED TENANT IS CHECKED, NEVER ADOPTED", async () => {
  const { repo } = await twoTenants();

  // Stating the one they belong to is fine.
  const ok = await resolvePrincipalContext(repo, { externalSubject: "subject-a", requestedTenantId: TENANT_A });
  assert.equal(ok.tenantId, TENANT_A);

  // Stating another is REFUSED -- not quietly narrowed back to their own. Falling back would make a
  // spoofed id indistinguishable from a correct one in every log and every response.
  await assert.rejects(
    () => resolvePrincipalContext(repo, { externalSubject: "subject-a", requestedTenantId: TENANT_B }),
    (err) => err instanceof PrincipalContextError && err.refusal === "TENANT_NOT_A_MEMBERSHIP",
  );
});

test("a principal in SEVERAL tenants must state one, and guessing is refused", async () => {
  const { repo } = await twoTenants();

  await assert.rejects(
    () => resolvePrincipalContext(repo, { externalSubject: "subject-both" }),
    (err) => err instanceof PrincipalContextError && err.refusal === "AMBIGUOUS_TENANT",
    "guessing is how one tenant's administrator edits another tenant's policy",
  );

  for (const tenantId of [TENANT_A, TENANT_B]) {
    const context = await resolvePrincipalContext(repo, {
      externalSubject: "subject-both", requestedTenantId: tenantId,
    });
    assert.equal(context.tenantId, tenantId, "and stating one they belong to works");
  }
});

test("unknown, disabled and non-member are three DIFFERENT refusals", async () => {
  const { repo } = await twoTenants();
  const cases = [
    ["subject-nobody", "UNKNOWN_PRINCIPAL"],
    ["subject-disabled", "PRINCIPAL_DISABLED"],
    ["subject-inactive", "NO_TENANT_MEMBERSHIP"],
  ];
  for (const [subject, refusal] of cases) {
    await assert.rejects(
      () => resolvePrincipalContext(repo, { externalSubject: subject }),
      (err) => err instanceof PrincipalContextError && err.refusal === refusal,
      `${subject} -> ${refusal}`,
    );
  }
});

test("the resolved uid is the EOS principal, not the identity provider's subject", async () => {
  const { repo, onlyA } = await twoTenants();
  const context = await resolvePrincipalContext(repo, { externalSubject: "subject-a" });
  assert.equal(context.uid, onlyA.id);
  assert.notEqual(context.uid, "subject-a", "replacing the provider must not rewrite every assignment");
  assert.equal(context.principal.externalSubject, "subject-a", "the mapping is kept, not discarded");
});

test("the same subject from a DIFFERENT provider is a different principal", async () => {
  const { repo } = await twoTenants();
  // Provider-scoped by construction: two providers claiming the same subject string are making two
  // different claims about who somebody is.
  await assert.rejects(
    () => resolvePrincipalContext(repo, { externalSubject: "subject-a", identityProvider: "someone-else" }),
    (err) => err instanceof PrincipalContextError && err.refusal === "UNKNOWN_PRINCIPAL",
  );
});

test("a principal with a context but no Roles holds nothing", async () => {
  const { repo } = await twoTenants();
  const context = await resolvePrincipalContext(repo, { externalSubject: "subject-a" });
  assert.deepEqual(context.heldRoleKeys, [], "membership is not authority");
  assert.equal(context.accessVersion, 0);
});

// ============================ the operation list is closed ============================

test("THE OPERATION LIST IS CLOSED — no generic mutation exists", async () => {
  for (const name of [
    "runSQL", "sql", "query", "mutatePolicy", "patchAnything", "patch", "update", "exec",
    "constructor", "__proto__", "toString",
  ]) {
    assert.equal(isAdminOperation(name), false, `"${name}" must not be an operation`);
  }
});

test("every operation is either a read or a mutation, and none is both", () => {
  const reads = new Set(ADMIN_READ_OPERATIONS);
  const mutations = new Set(ADMIN_MUTATION_OPERATIONS);
  assert.equal(reads.size, ADMIN_READ_OPERATIONS.length, "no duplicates");
  assert.equal(mutations.size, ADMIN_MUTATION_OPERATIONS.length);
  for (const name of reads) {
    assert.equal(mutations.has(name), false, `${name} cannot be both`);
    assert.equal(isMutation(name), false);
  }
  for (const name of mutations) assert.equal(isMutation(name), true);

  // The Owner's list, pinned. A read that quietly became a mutation, or an operation that appeared
  // without being asked for, fails here.
  assert.deepEqual([...reads].sort(), [
    "listObjects", "listPrincipalRoleAssignments", "listRoles", "listTenantPrincipals", "listWorkflows",
    "readObjectWithFields", "readPolicyAuditHistory", "readRolePolicy", "readWorkflowVersion",
  ], "the Owner's eight, plus listTenantPrincipals -- without which none of them yields a principal id");
  assert.deepEqual([...mutations].sort(), [
    "assignRole", "createCustomField", "createRole", "createWorkflowDraft", "createWorkflowVersion",
    "publishWorkflowVersion", "removeFieldPermissionOverride", "revokeRole", "setFieldPermissionOverride",
    "setObjectPermission", "setWorkflowRoleBinding", "updateCustomFieldMetadata",
    // Object DISPLAY metadata only -- no key edit, no delete, no generic patch. Added because
    // "Object definition editing is Admin-only" was a contract with no operation behind it.
    "updateObjectMetadata",
    "updateRole",
    "updateWorkflowDefinition",
  ]);
});

test("an unknown operation is refused before any identity is resolved", async () => {
  const { repo } = await twoTenants();
  const result = await executeAdminOperation({ repo }, {
    caller: { externalSubject: "subject-a" }, operation: "runSQL", input: { sql: "DROP TABLE tenants" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNKNOWN_OPERATION");
});

// ============================ listTenantPrincipals returns identity, never authority ============================

test("listTenantPrincipals returns EXACTLY these five fields, and never a sixth", async () => {
  // Owner ruling A: minimal, and pinned. A field added here in passing -- a token, a claim, a Role,
  // an access version -- would be a widening nobody reviewed, and it would ship looking like a
  // convenience. The assertion is the exact key set rather than "does not contain X", because a
  // deny-list only refuses the things somebody thought of.
  const { repo, onlyA } = await twoTenants();
  const result = await executeAdminOperation({ repo }, {
    caller: { externalSubject: "subject-a" }, operation: "listTenantPrincipals",
  });

  assert.equal(result.ok, true);
  assert.ok(result.data.length > 0);
  for (const principal of result.data) {
    assert.deepEqual(
      Object.keys(principal).sort(),
      ["displayName", "externalSubject", "id", "identityProvider", "status"],
      "exactly the five fields needed to select and administer a principal",
    );
  }
  assert.ok(result.data.some((p) => p.id === onlyA.id));
});

test("listTenantPrincipals is TENANT-SCOPED: another tenant's principals are not in the answer", async () => {
  // Not filtered out afterwards -- never in the query. The population comes from this tenant's
  // memberships, and the tenant came from the caller's own membership.
  const { repo, both } = await twoTenants();

  const fromA = await executeAdminOperation({ repo }, {
    caller: { externalSubject: "subject-a" }, operation: "listTenantPrincipals",
  });
  const ids = fromA.data.map((p) => p.id);

  // `both` is a member of A and B, so they appear. A principal of B alone must not.
  assert.ok(ids.includes(both.id), "a member of this tenant appears");

  const onlyB = await repo.transact({ tenantId: "tenant-b", uid: "setup" }, async (tx) => {
    const principal = await tx.createPrincipal({ externalSubject: "subject-b-only", identityProvider: "firebase" });
    await tx.createTenantMembership(principal.id);
    return principal;
  });

  const again = await executeAdminOperation({ repo }, {
    caller: { externalSubject: "subject-a" }, operation: "listTenantPrincipals",
  });
  assert.equal(
    again.data.some((p) => p.id === onlyB.id), false,
    "a principal who belongs only to the other tenant is not in this tenant's answer",
  );
});

test("listTenantPrincipals carries NO authority — no Role, no permission, no access version", async () => {
  const { repo } = await twoTenants();
  const result = await executeAdminOperation({ repo }, {
    caller: { externalSubject: "subject-a" }, operation: "listTenantPrincipals",
  });
  const serialized = JSON.stringify(result.data);
  for (const forbidden of ["role", "Role", "permission", "cred", "accessVersion", "token", "claim", "password"]) {
    assert.equal(
      serialized.includes(forbidden), false,
      `"${forbidden}" has no place in an answer about WHO somebody is`,
    );
  }
});

// ============================ the transport carries no authority ============================

test("HTTP: only the VERIFIED subject is used — a body that claims a caller is ignored", async () => {
  const { repo } = await twoTenants();

  const response = await handleAdminRequest(
    { repo, verifyToken: async () => ({ externalSubject: "subject-a", identityProvider: "firebase" }) },
    {
      method: "POST",
      url: "/admin/policy",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({
        operation: "listObjects",
        caller: { externalSubject: "subject-both" },
        externalSubject: "subject-both",
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).tenantId, TENANT_A, "the verifier decided, not the body");
});

test("HTTP: a claimed tenant travels as a HEADER and is still only a preference", async () => {
  const { repo } = await twoTenants();
  const call = (tenant) => handleAdminRequest(
    { repo, verifyToken: async () => ({ externalSubject: "subject-a", identityProvider: "firebase" }) },
    {
      method: "POST",
      url: "/admin/policy",
      headers: { authorization: "Bearer token", "x-eos-tenant": tenant },
      body: JSON.stringify({ operation: "listObjects" }),
    },
  );

  assert.equal((await call(TENANT_A)).status, 200);
  const wrong = await call(TENANT_B);
  assert.equal(wrong.status, 403, "a tenant they do not belong to is refused, not narrowed");
});

test("HTTP: there is no route that takes a table, a statement or a patch", async () => {
  const { repo } = await twoTenants();
  const verifyToken = async () => ({ externalSubject: "subject-a", identityProvider: "firebase" });

  for (const url of ["/admin/sql", "/admin/policy/tenants", "/sql", "/admin", "/"]) {
    const response = await handleAdminRequest({ repo, verifyToken }, {
      method: "POST", url, headers: { authorization: "Bearer t" }, body: "{}",
    });
    assert.equal(response.status, 404, `${url} is not a route`);
  }
});

test("HTTP: CORS never answers with a wildcard, and echoes only an allowed origin", async () => {
  const { repo } = await twoTenants();
  const options = {
    repo,
    verifyToken: async () => ({ externalSubject: "subject-a", identityProvider: "firebase" }),
    allowedOrigins: ["http://localhost:5173"],
  };

  const allowed = await handleAdminRequest(options, {
    method: "OPTIONS", url: "/admin/policy", headers: { origin: "http://localhost:5173" },
  });
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");

  const foreign = await handleAdminRequest(options, {
    method: "OPTIONS", url: "/admin/policy", headers: { origin: "https://evil.example" },
  });
  assert.equal(foreign.headers["access-control-allow-origin"], undefined, "not echoed");
  for (const response of [allowed, foreign]) {
    assert.notEqual(response.headers["access-control-allow-origin"], "*");
    assert.equal(response.headers["cache-control"], "no-store", "policy is never cached");
  }
});

// ============================ the service refuses production ============================

test("the service REFUSES to start when its environment names production", () => {
  for (const value of ["production", "PRODUCTION", "prod"]) {
    assert.throws(
      () => readServiceConfig({ EOS_ENVIRONMENT: value, DATABASE_URL: "postgres://x/y" }),
      ServiceConfigError,
      `${value} is refused`,
    );
  }
  const ok = readServiceConfig({ EOS_ENVIRONMENT: "nonprod", EOS_API_PORT: "8787" });
  assert.equal(ok.environment, "nonprod");
  assert.equal(ok.port, 8787);
});

test("a wildcard browser origin is refused by configuration", () => {
  assert.throws(
    () => readServiceConfig({ EOS_ALLOWED_ORIGINS: "http://localhost:5173,*" }),
    ServiceConfigError,
    "a wildcard would let any page a signed-in administrator visits read this tenant's policy",
  );
});

test("a connection string is never logged with its credentials", () => {
  assert.equal(
    redactConnectionString("postgres://user:hunter2@db.example:5432/eos?sslmode=require"),
    "postgres://***:***@db.example:5432/eos?sslmode=require",
  );
  assert.equal(redactConnectionString(undefined), "(none)");
  assert.equal(redactConnectionString("host=db user=u password=p"), "(unparseable connection string)");
});

// ============================ the Firebase boundary ============================

test("THE NEW OPERATIONAL PATH READS AND WRITES NO FIRESTORE", () => {
  // A companion to the static import guard, aimed at the files this tranche ADDED. The rule is not
  // "no Firebase anywhere" -- authentication is still Firebase -- it is that no POLICY is persisted
  // in, or read from, Firestore. A transitional identity lookup is not business-policy persistence,
  // and the distinction is kept explicit rather than blurred.
  const NEW_OPERATIONAL_FILES = [
    "src/adminPolicy/principalContext.ts",
    "src/adminPolicy/tenantBootstrap.ts",
    "src/adminPolicy/adminPolicyApi.ts",
    "src/adminPolicy/adminPolicyHttp.ts",
    "src/adminPolicy/workflowCommands.ts",
  ];

  const strip = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  for (const file of NEW_OPERATIONAL_FILES) {
    const code = strip(readFileSync(file, "utf8"));
    for (const banned of ["firebase-admin", "firebase/firestore", "getFirestore", "firestore()", "collection("]) {
      assert.equal(code.includes(banned), false, `${file} must not reference ${banned}`);
    }
  }
});

test("the SERVICE is where Firebase lives, and it reads only a subject", () => {
  // server.ts is deliberately OUTSIDE src/adminPolicy so the policy subsystem's static guard stays
  // absolute rather than acquiring an allowlist entry. What it may do with Firebase is bounded:
  // verify a token and take the uid.
  const code = readFileSync("src/eosApi/server.ts", "utf8");
  assert.ok(code.includes("verifyIdToken"), "it verifies a token");
  assert.ok(code.includes("decoded.uid"), "and takes the subject");
  for (const banned of ["getFirestore", "firestore()", ".collection(", "customClaims", "claims."]) {
    assert.equal(code.includes(banned), false, `the service must not read ${banned}`);
  }
});
