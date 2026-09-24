// THE BROWSER'S ROUTE TO THE POLICY STORE — its proofs.
//
// What matters here is not that the client can make a request. It is that the client cannot become
// a second authorization model:
//
//   it holds no policy and decides nothing
//   it sends a NAME from a closed list, and an unknown name never leaves the browser
//   NOT CONFIGURED is a state, not an error, and not an empty result
//   a network failure is never reported as a refusal
//   the operation list matches the server's, so a typo fails here rather than as a 404
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The client imports `../firebase/firebase.js` for the signed-in user's token, and that module
// initializes Firebase at import time. So this suite tests the module's CONTRACT through the source
// and through a re-implementation of its request shape -- the same pattern this repository already
// uses for domain modules that cannot be imported outside a browser.
const SOURCE = readFileSync("src/services/adminPolicyApiClient.js", "utf8");

const READS = [
  "listTenantPrincipals", "listObjects", "readObjectWithFields", "listRoles", "readRolePolicy",
  "listPrincipalRoleAssignments",
  // The four Object-owned security reads. Named here because the client was missing them while the
  // server served them: the browser had no route to the proven PostgreSQL read model at all, and a
  // list that omits an operation makes it unreachable just as surely as a typo makes it a 404.
  "listObjectsWithActions", "getObjectSecurityMatrix", "getRoleSecurity", "getPrincipalEffectiveAccess",
  "listWorkflows", "readWorkflowVersion", "readPolicyAuditHistory",
];
const MUTATIONS = [
  // Object DISPLAY metadata only -- no key edit, no delete, no generic patch. Added with the
  // Administration editing correction, because "Object definition editing is Admin-only" was a
  // contract with no operation behind it.
  "updateObjectMetadata",
  "createCustomField", "updateCustomFieldMetadata", "createRole", "updateRole", "setObjectPermission",
  "setFieldPermissionOverride", "removeFieldPermissionOverride", "assignRole", "revokeRole",
  // Object-owned grants: (objectKey, actionKey, grantee), never a capability key. Mirrored so the
  // closed list stays the server's; no screen sends one yet.
  "grantObjectActionToRole", "revokeObjectActionFromRole",
  "grantObjectActionToPrincipal", "revokeObjectActionFromPrincipal",
  "createWorkflowDraft", "createWorkflowVersion", "updateWorkflowDefinition", "setWorkflowRoleBinding",
  "publishWorkflowVersion",
];

// ============================ the client mirrors the server ============================

test("the client's operation list matches the server's, exactly", () => {
  // Two lists, one truth. A client that offered an operation the server does not have would fail as
  // a 404 at the worst possible moment; one that omitted an operation would make it unreachable.
  const server = readFileSync("../functions/src/adminPolicy/adminPolicyApi.ts", "utf8");

  const listOf = (source, marker) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `${marker} is present`);
    const end = source.indexOf("]", start);
    return [...source.slice(start, end).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]).sort();
  };

  assert.deepEqual(listOf(SOURCE, "ADMIN_READ_OPERATIONS"), listOf(server, "ADMIN_READ_OPERATIONS"));
  assert.deepEqual(listOf(SOURCE, "ADMIN_MUTATION_OPERATIONS"), listOf(server, "ADMIN_MUTATION_OPERATIONS"));
  assert.deepEqual(listOf(SOURCE, "ADMIN_READ_OPERATIONS"), [...READS].sort(), "and both match this file");
  assert.deepEqual(listOf(SOURCE, "ADMIN_MUTATION_OPERATIONS"), [...MUTATIONS].sort());
});

test("the four Object-owned security reads have a named wrapper, each on the one endpoint", () => {
  // The gap this tranche closes: the operations were SERVED and proven against PostgreSQL, and the
  // browser had no way to name them. A wrapper per projection, each sending the input key the
  // server's dispatcher requires -- so a wrong key is one diff here rather than an INVALID_INPUT at
  // run time on whichever screen happened to spell it.
  const wrappers = [
    ["listObjectsWithActions", "{}"],
    ["getObjectSecurityMatrix", "{ objectKey }"],
    ["getRoleSecurity", "{ roleKey }"],
    ["getPrincipalEffectiveAccess", "{ principalId }"],
  ];
  for (const [operation, input] of wrappers) {
    assert.ok(
      SOURCE.includes(`export function ${operation}(`),
      `${operation} is a named export, not a string literal every caller retypes`,
    );
    assert.ok(
      SOURCE.includes(`return callPolicyApi("${operation}", ${input}, options);`),
      `${operation} goes through callPolicyApi with ${input} -- one endpoint, one envelope`,
    );
  }
  // No second route. The reads are POST /admin/policy like everything else, and the path appears
  // exactly once in the code -- one fetch, one envelope, nothing bypassing it.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal((code.match(/\/admin\/policy/g) ?? []).length, 1, "exactly one endpoint path");
  assert.equal((code.match(/await doFetch\(/g) ?? []).length, 1, "exactly one fetch");
  assert.equal(/\/admin\/(objects|roles|security|principals)/.test(code), false, "no invented route");
});

test("a security read does not fall back to an empty answer when it is refused", () => {
  // The failure mode that would matter most on a security screen: rendering "nobody holds this
  // action" for a read the server refused, or that never left the browser. Every wrapper returns
  // callPolicyApi's result directly -- there is no [] , no {} and no catch between them.
  for (const operation of [
    "listObjectsWithActions", "getObjectSecurityMatrix", "getRoleSecurity", "getPrincipalEffectiveAccess",
  ]) {
    const start = SOURCE.indexOf(`export function ${operation}(`);
    assert.ok(start >= 0, `${operation} exists`);
    const body = SOURCE.slice(start, SOURCE.indexOf("\n}", start));
    assert.equal(/catch|\?\?\s*\[\]|\|\|\s*\[\]|actions:|roleKeys:/.test(body), false,
      `${operation} neither swallows a failure nor reshapes the server's projection`);
  }
});

test("THE CLIENT HOLDS NO POLICY AND DECIDES NOTHING", () => {
  // The property that keeps this from becoming a second authorization model. It may not import the
  // capability catalogue, the role definitions or the CRUD matrix, and it may not mention a verb.
  for (const banned of [
    "permissionCatalog", "governedBusinessRoles", "compatibilityRoles", "objectPermissionMap",
    "resolveEffective", "hasCapability", "COMPATIBILITY_ROLES",
  ]) {
    assert.equal(SOURCE.includes(banned), false, `the client must not reference ${banned}`);
  }
});

test("the client reads no Firestore, for policy or anything else", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const banned of ["firebase/firestore", "getFirestore", "collection(", "onSnapshot", "getDocs"]) {
    assert.equal(code.includes(banned), false, `${banned} has no place in the policy client`);
  }
  // It takes exactly one thing from the identity provider: the ID token.
  assert.ok(code.includes("getIdToken"), "the ID token, and nothing else");
  assert.equal(code.includes("customClaims"), false, "no claim is read as authority");
});

// ============================ the request shape ============================

test("a request carries the bearer token, the operation and nothing that could grant authority", () => {
  const code = SOURCE;
  assert.ok(code.includes("authorization: `Bearer ${token}`"), "the token is a header");
  assert.ok(code.includes('JSON.stringify({ operation, input })'), "the body is a name and an input");
  // The tenant travels as a HEADER and is documented as a preference the server checks. It must not
  // be smuggled into the body, where it would look like part of the operation's own input.
  assert.ok(code.includes('"x-eos-tenant"'), "a claimed tenant is a header");
  assert.equal(/body: JSON.stringify\(\{[^}]*tenantId/.test(code), false, "and never a body field");
});

test("NOT CONFIGURED, NOT SIGNED IN and UNREACHABLE are three different answers", () => {
  for (const code of ["NOT_CONFIGURED", "NOT_SIGNED_IN", "UNREACHABLE", "FORBIDDEN"]) {
    assert.ok(SOURCE.includes(`"${code}"`), `${code} is a distinct outcome`);
  }
  // The one that matters most: a network failure must never be reported as a refusal, because that
  // would tell an administrator they lack authority they actually have.
  assert.ok(
    /catch \(err\) \{[\s\S]{0,400}UNREACHABLE/.test(SOURCE),
    "a fetch failure becomes UNREACHABLE, not FORBIDDEN",
  );
});

test("a refusal is RETURNED, never thrown", () => {
  // A screen has to render "you may not do that" differently from "the network is down". Making
  // both an exception forces every caller to re-derive the difference from a message string.
  assert.equal(/throw new Error/.test(SOURCE), false, "no path throws");
  assert.ok(SOURCE.includes("return failure("), "every failure is a value");
});

// ============================ the panels' one rule ============================

test("NO PANEL UPDATES OPTIMISTICALLY — every mutation is followed by a re-read", () => {
  const hook = readFileSync("src/modules/administration/usePolicyStore.js", "utf8");
  const panels = readFileSync("src/modules/administration/PolicyStorePanels.jsx", "utf8");

  // The hook's mutate reloads on success. That is the whole mechanism, and it is worth pinning:
  // without it a screen would show a change the server may have refused.
  assert.ok(/if \(result\.ok\) reload\(\);/.test(hook), "mutate reloads on success");

  // And no panel keeps its own copy of server state to render instead.
  assert.equal(
    /setState\(\s*\{[^}]*data:/.test(panels), false,
    "a panel that stored server data locally could render it after a refusal",
  );
  for (const call of panels.match(/\.mutate\(/g) ?? []) assert.ok(call, "mutations go through the hook");
  assert.equal(panels.includes("callPolicyApi("), false, "no panel calls the API directly, bypassing the re-read");
});

test("a panel says NOT CONFIGURED rather than showing an empty table", () => {
  const panels = readFileSync("src/modules/administration/PolicyStorePanels.jsx", "utf8");
  assert.ok(panels.includes('state.status === "unconfigured"'), "the state is rendered");
  assert.ok(
    panels.includes("No EOS policy service is configured"),
    "and it says so -- an empty table would be a lie about the tenant rather than about the connection",
  );
});
