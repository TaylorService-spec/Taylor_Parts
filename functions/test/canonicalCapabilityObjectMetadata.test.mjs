// THE CANONICAL OBJECT <- ACTION MAPPING -- proved against a real postgres:16 and the seed catalog.
//
// Security is governed UNDER THE OBJECT. Before migration 1761350400000 there was no join between a
// capability and the Object it governs, so Administration kept its own map and that map drifted to
// naming 27 capabilities eos_policy.capabilities has never defined. These tests exist so the
// canonical mapping cannot drift the same way: every capability must carry its Object and action,
// every Object named must exist, and no frontend catalog may author either.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(FUNCTIONS_DIR, "..");
const read = (p) => readFileSync(resolve(REPO_DIR, p), "utf8");

const SNAPSHOT = JSON.parse(read("functions/src/adminPolicy/seed/policySeedSnapshot.json"));
const OBJECT_KEYS = new Set(SNAPSHOT.objects.map((o) => o.key));
const ACTION_KINDS = new Set(["CREATE", "READ", "EDIT", "DELETE", "BUSINESS_ACTION", "ADMIN_ACTION"]);

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

// ════════════════════ the canonical catalog, with no database ════════════════════

test("the Object catalog registers Workflow as two Objects and its sub-entities as none", () => {
  assert.ok(OBJECT_KEYS.has("workflowDefinition"), "workflowDefinition must be a governed Object");
  assert.ok(OBJECT_KEYS.has("workflowInstance"), "workflowInstance must be a governed Object");
  // Steps, actions and bindings are version-scoped: they have no independent lifecycle, so making
  // them Objects would invite a security matrix for something that cannot be secured on its own.
  for (const notAnObject of ["workflowStep", "workflowAction", "workflowRoleBinding", "workflowVersion"]) {
    assert.equal(OBJECT_KEYS.has(notAnObject), false, `${notAnObject} is a sub-entity, not an Object`);
  }
});

test("Employee and Principal are distinct Objects, and Employee is not called Users", () => {
  const employee = SNAPSHOT.objects.find((o) => o.key === "employee");
  const principal = SNAPSHOT.objects.find((o) => o.key === "principal");
  assert.ok(employee && principal, "both must exist");
  assert.notEqual(employee.label, "Users",
    "labelling the workforce record 'Users' is the Principal/Employee conflation this programme removes");
  assert.equal(employee.label, "Employees");
  assert.equal(principal.label, "Principal");
  assert.ok(/never the employee/i.test(principal.description),
    "the Principal's own description must state the separation");
});

test("no frontend catalog authors the canonical mapping", () => {
  const migration = read("functions/migrations/1761350400000_canonical-capability-object-action-metadata.sql");
  // Naming objectPermissionMap.js in a COMMENT is how this codebase records what it replaced, and
  // three files legitimately do. The rule is that no module may IMPORT or read it as data, so the
  // probe strips comments first rather than matching prose -- a probe that fails on an accurate
  // comment teaches people to delete true comments.
  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const importers = execFileSync("grep", ["-rl", "objectPermissionMap", "src"], { cwd: FUNCTIONS_DIR, encoding: "utf8" })
    .split("\n").filter(Boolean)
    .filter((f) => /objectPermissionMap/.test(stripComments(readFileSync(resolve(FUNCTIONS_DIR, f), "utf8"))));
  assert.deepEqual(importers, [], "no functions/src module may read the frontend object permission map");
  // Non-vacuity: the grep itself must still be finding the files whose comments mention it.
  assert.ok(execFileSync("grep", ["-rl", "objectPermissionMap", "src"], { cwd: FUNCTIONS_DIR, encoding: "utf8" }).trim().length > 0,
    "the probe stopped matching anything and would now pass for the wrong reason");
  assert.equal(/permissionCatalog/.test(stripComments(migration)), false,
    "the canonical mapping may not be derived from the Firebase permission catalog");
});

test("the safety invariant never grants, and capability alone never overrides it", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const auth = require("../lib/adminPolicy/administrationAuthority.js");
  const cap = auth.WORKFLOW_DEFINITION_CAPABILITY_BY_ACTION.publish;
  assert.equal(cap, "workflowDefinition.publish");

  // capability ABSENT + admin-style authority satisfied => FORBIDDEN, not allowed.
  assert.deepEqual(
    auth.decideWorkflowAdministration({ capabilities: new Set(["workflowDefinition.read"]), action: "publish", wouldRemoveLastAdministrationPath: false }),
    { allowed: false, refusal: "CAPABILITY_MISSING" });
  // Holding the admin ROLE is not a capability and must not authorize.
  assert.equal(auth.hasAdministrationAuthority(["admin"], "editWorkflowDefinition"), true,
    "the legacy invariant still answers its own question");
  assert.deepEqual(
    auth.decideWorkflowAdministration({ capabilities: new Set(), action: "publish", wouldRemoveLastAdministrationPath: false }),
    { allowed: false, refusal: "CAPABILITY_MISSING" },
    "the invariant must not stand in for the capability");

  // capability PRESENT + invariant violated => refused for safety.
  assert.deepEqual(
    auth.decideWorkflowAdministration({ capabilities: new Set([cap]), action: "publish", wouldRemoveLastAdministrationPath: true }),
    { allowed: false, refusal: "WOULD_REMOVE_LAST_ADMINISTRATION_PATH" });

  // capability PRESENT + invariant satisfied => allowed.
  assert.deepEqual(
    auth.decideWorkflowAdministration({ capabilities: new Set([cap]), action: "publish", wouldRemoveLastAdministrationPath: false }),
    { allowed: true });
});

test("workflow execution stays inert: the doorway guard has nothing to bypass yet", () => {
  // WORKFLOW_BINDING_CANNOT_WIDEN_OBJECT_AUTHORITY. A binding may narrow who attempts an action; it
  // may never authorize a target business act on its own. Today that is guaranteed structurally,
  // because the engine's decision functions have no caller. The day someone wires execution this
  // test fails, which is the moment the target-capability intersection must exist.
  const hits = execFileSync("grep", ["-rl", "-e", "decideWorkflowAction", "-e", "allowedWorkflowActions", "src"],
    { cwd: FUNCTIONS_DIR, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.deepEqual(hits, ["src/adminPolicy/workflowEngine.ts"],
    "workflow execution was wired without a target-Object capability intersection");
  // And no module writes a workflow instance outside the policy store.
  const workflowSrc = read("functions/src/adminPolicy/workflowEngine.ts");
  assert.equal(/eos_ops\.|eos_crm\.|eos_commercial\./.test(workflowSrc), false,
    "the workflow engine must never mutate a business table directly");
});

// ════════════════════ against the real database ════════════════════

test("canonical capability metadata, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `capmeta_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const rows = async (sql, v = []) => (await pool.query(sql, v)).rows;

  const caps = await rows(`SELECT key, object_key, action_key, action_kind, display_label FROM eos_policy.capabilities ORDER BY key`);

  await t.test("every capability carries a complete canonical mapping", () => {
    assert.ok(caps.length >= 49, `expected the full vocabulary, saw ${caps.length}`);
    for (const c of caps) {
      assert.ok(c.object_key, `${c.key} has no object_key`);
      assert.ok(c.action_key, `${c.key} has no action_key`);
      assert.ok(ACTION_KINDS.has(c.action_kind), `${c.key} has action_kind ${c.action_kind}`);
      assert.ok(c.display_label && c.display_label !== c.key,
        `${c.key} needs a friendly label, not its own key`);
    }
  });

  await t.test("every Object a capability names is a registered Object", () => {
    const missing = [...new Set(caps.map((c) => c.object_key))].filter((k) => !OBJECT_KEYS.has(k)).sort();
    assert.deepEqual(missing, [], "capabilities may not point at Objects the catalog does not define");
  });

  await t.test("Work Order lifecycle capabilities belong to the Work Order", () => {
    const wo = new Map(caps.filter((c) => c.object_key === "workOrder").map((c) => [c.key, c]));
    for (const k of ["workOrder.create", "workOrder.transition", "workOrder.lifecycle.dispatch",
      "workOrder.lifecycle.cancel", "workOrder.lifecycle.complete"]) {
      assert.ok(wo.has(k), `${k} must map to workOrder`);
    }
    assert.equal(wo.get("workOrder.lifecycle.dispatch").action_key, "dispatch");
    assert.equal(wo.get("workOrder.lifecycle.complete").action_kind, "BUSINESS_ACTION");
    // Prefix did not decide this one: the key says `inventory.`, the Object is the Work Order.
    assert.equal(wo.get("inventory.workOrderConsumption.record")?.object_key, "workOrder");
  });

  await t.test("one Object may not name the same action twice", async () => {
    assert.equal(caps.some((c) => c.key === "workOrder.cancel"), false,
      "workOrder.cancel would duplicate workOrder.lifecycle.cancel");
    await assert.rejects(
      pool.query(`INSERT INTO eos_policy.capabilities (id,key,description,object_key,action_key,action_kind,display_label)
                  VALUES ('cap_dup','workOrder.cancel','dup','workOrder','cancel','BUSINESS_ACTION','Cancel Work Order')`),
      /unique|duplicate/i);
  });

  await t.test("the drift guard refuses a capability with no canonical mapping", async () => {
    await assert.rejects(
      pool.query(`INSERT INTO eos_policy.capabilities (id,key,description) VALUES ('cap_nometa','some.new.capability','no metadata')`),
      /null value|not-null/i,
      "a capability without object/action metadata must be impossible to insert");
    await assert.rejects(
      pool.query(`INSERT INTO eos_policy.capabilities (id,key,description,object_key,action_key,action_kind,display_label)
                  VALUES ('cap_badkind','some.other.capability','bad kind','workOrder','frobnicate','SOMETHING_ELSE','Frobnicate')`),
      /capabilities_action_kind_known/,
      "action_kind must come from the governed list");
  });

  await t.test("Workflow Definition has exactly the six actions that exist today", () => {
    const wf = caps.filter((c) => c.object_key === "workflowDefinition");
    assert.deepEqual(wf.map((c) => c.action_key).sort(),
      ["bindRole", "create", "edit", "publish", "read", "version"]);
    // Nothing invented for a button that does not exist.
    for (const absent of ["execute", "activate", "deactivate", "test", "archive", "delete"]) {
      assert.equal(wf.some((c) => c.action_key === absent), false,
        `workflowDefinition.${absent} names an operation this platform does not have`);
    }
    assert.equal(wf.find((c) => c.action_key === "publish").action_kind, "ADMIN_ACTION");
    assert.equal(wf.find((c) => c.action_key === "create").action_kind, "CREATE");
  });

  await t.test("workflowInstance has no capability yet, deliberately", () => {
    assert.deepEqual(caps.filter((c) => c.object_key === "workflowInstance"), [],
      "execution security is designed with target-Object enforcement, not back-filled");
  });

  await t.test("this migration grants nothing", async () => {
    const [{ granted }] = await rows(
      `SELECT count(*)::int AS granted FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE c.object_key = 'workflowDefinition'`);
    assert.equal(granted, 0, "workflow capabilities are vocabulary, not grants");
    const [{ lifecycle }] = await rows(
      `SELECT count(*)::int AS lifecycle FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE c.key LIKE 'workOrder.lifecycle.%'`);
    assert.equal(lifecycle, 0, "the Work Order lifecycle grant decision is a later slice");
  });

  await t.test("role_object_permissions is preserved, not replaced", async () => {
    const [{ present }] = await rows(
      `SELECT count(*)::int AS present FROM information_schema.tables
        WHERE table_schema='eos_policy' AND table_name='role_object_permissions'`);
    assert.equal(present, 1,
      "ACTIVE_SPLIT_AUTHORITY_PENDING_CONVERGENCE -- effectiveObjectAccess.ts still consumes this");
  });
});
