// INBOUND WORK ON POSTGRESQL (Owner ruling W9, 2026-09-30) -- the accepted Inbound Work behaviour, proven against the
// governed PostgreSQL intake through the REAL transport (handleOperationsRequest on /operations/inbound-work) with real
// Role grants resolved by resolveOperationalContext, using the SAME synthetic provider fixtures the Firebase emulator
// suite uses (scripts/fixtures/inboundWorkFixtures.mjs -- provider-native Microsoft Graph and Gmail shapes).
//
// Accept -> the governed EOS Work Order create (company STATED, replay-safe); Attach -> governed association;
// Decline -> governed state. Preserved: original message evidence, extracted fields, review, exact-key suggestions,
// thread association, duplicate protection, quarantine, audit.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import {
  SANDBOX_CONNECTION,
  SANDBOX_MAILBOX_CONFIGS,
  SANDBOX_MAILBOXES,
  SANDBOX_ROUTING_RULES,
  SANDBOX_RECORDS,
  FIXTURE_CORPORATE_WARRANTY,
  FIXTURE_WARRANTY_REPLY,
  FIXTURE_UNKNOWN_CUSTOMER,
  FIXTURE_TO_DECLINE,
  FIXTURE_GMAIL_SERVICE,
} from "../scripts/fixtures/inboundWorkFixtures.mjs";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { handleOperationsRequest } = require("../lib/eosOps/eosOpsHttp.js");
const { INBOUND_WORK_ROUTE, EOS_INBOUND_WORK_OPERATIONS } = require("../lib/eosOps/inboundWorkOperations.js");
const { ingestInboundMessage, inboundRequestId, InboundWorkError } = require("../lib/eosOps/inboundWorkIntake.js");
const { acceptIdempotencyKey } = require("../lib/eosOps/inboundWorkDecisions.js");
const { normalizeProviderMessage } = require("../lib/inboundWork/emailProvider.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-inbound";
const FIXTURE_ACTOR = "fixture";
const INBOUND_KEYS = ["inboundWork.request.read", "inboundWork.request.accept", "inboundWork.request.decline", "inboundWork.request.attach", "inboundWork.intake.manage"];
const REVIEW = ["inboundWork.request.read", "inboundWork.request.accept", "inboundWork.request.decline", "inboundWork.request.attach"];

// ════════════════════ static: the EOS intake path imports no Firebase ════════════════════
test("static: the PostgreSQL Inbound Work modules reach no Firebase module, transitively", () => {
  const seen = new Set();
  const offenders = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/require\("([^"]+)"\)/g)) {
      const spec = m[1];
      if (/firebase/.test(spec)) offenders.push(`${file.replace(FUNCTIONS_DIR, "")} -> ${spec}`);
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec.endsWith(".js") ? spec : `${spec}.js`);
        if (existsSync(target)) visit(target);
      }
    }
  };
  for (const f of ["inboundWorkOperations.js", "inboundWorkIntake.js", "inboundWorkDecisions.js"]) visit(resolve(FUNCTIONS_DIR, "lib/eosOps", f));
  assert.deepEqual(offenders, [], "no firebase / firebase-admin / firebase-functions import anywhere in the graph");
  for (const f of ["inboundWorkOperations.ts", "inboundWorkIntake.ts", "inboundWorkDecisions.ts"]) {
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps", f), "utf8");
    assert.doesNotMatch(src, /from "(\.\.\/)+(createWorkOrder|inboundWork\/inboundDecisionCommands|inboundWork\/inboundWorkCallables)/,
      `${f} must not reach the Firebase Work Order-acting inbound path`);
  }
  assert.deepEqual(Object.keys(EOS_INBOUND_WORK_OPERATIONS).sort(), [
    "acceptInboundWork", "attachInboundWork", "declineInboundWork", "deliverInboundMessage", "listInboundWork",
    "readInboundIntakeConfiguration", "readInboundWorkAccess", "readInboundWorkRequest", "readWorkOrderAuthorityStatus",
    "saveInboundMailbox", "saveInboundRoutingRule",
  ]);
});

test("Inbound Work on PostgreSQL through /operations/inbound-work", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `inbwk_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];
  const repo = new PostgresPolicyRepository(pool);
  const fixtureActor = { tenantId: T, uid: FIXTURE_ACTOR };

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const [company, key] of [["taylor", "taylor"], ["ventana", "ventana"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, company]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys
               (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$3,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, company, key]);
  }
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,'unkeyed-co','ACTIVE','fixture','fixture','fixture')`, [T]);
  // The SANDBOX records the known-unit scenarios resolve against, in their governed PostgreSQL homes.
  const R = SANDBOX_RECORDS;
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ($1,$2,$3,'ACTIVE','f','f')`, [R.accountId, T, R.account.name]);
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('sbx-acct-other',$1,'Sandbox Other','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ($1,$2,$3,$4,'f','f')`,
    [R.locationId, T, R.accountId, R.location.name]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ('sbx-loc-other',$1,'sbx-acct-other','Other site','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.contacts (id,tenant_id,account_id,name,email,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'f','f')`,
    [R.contactId, T, R.accountId, R.contact.name, R.contact.email]);
  await q(`INSERT INTO eos_ops.equipment (id,tenant_id,operating_company_key,account_id,customer_location_id,name,status,serial_number,created_by,updated_by)
           VALUES ($1,$2,'taylor',$3,$4,$5,'ACTIVE',$6,'f','f')`, [R.equipmentId, T, R.accountId, R.locationId, R.equipment.name, " sbx-sn-0001 "]);

  let roleN = 0;
  const principalIds = {};
  const persona = async (subject, capabilities) => {
    const principalId = await repo.transact(fixtureActor, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "eos" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    principalIds[subject] = principalId;
    roleN += 1;
    const role = await repo.transact(fixtureActor, (tx) =>
      tx.createRole({ key: `inbound${roleN}`, name: `Inbound ${roleN}`, description: null, origin: "CUSTOM", protected: false }));
    for (const key of new Set(capabilities)) {
      const { rowCount } = await q(
        `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT $1, $2, $3, c.id, $4, $4, $4 FROM eos_policy.capabilities c WHERE c.key = $5`,
        [`rc_${role.id}_${key}`, T, role.id, FIXTURE_ACTOR, key]);
      assert.equal(rowCount, 1, `no capability named "${key}"`);
    }
    await repo.transact(fixtureActor, async (tx) => {
      const av = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: FIXTURE_ACTOR, grantedAt: new Date().toISOString(), accessVersionAtGrant: av });
    });
    return subject;
  };

  await t.test("the migration registers exactly five inbound capabilities, granted to NO Role", async () => {
    const { rows } = await q(`SELECT key, object_key, action_kind FROM eos_policy.capabilities WHERE key LIKE 'inboundWork.%' ORDER BY key`);
    assert.deepEqual(rows.map((r) => r.key), [...INBOUND_KEYS].sort());
    assert.deepEqual([...new Set(rows.map((r) => r.object_key))].sort(), ["inboundMailbox", "inboundWorkRequest"]);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                              WHERE c.key LIKE 'inboundWork.%'`)).n, 0, "definition != grant");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key LIKE 'service.inboundWork.%' OR key LIKE 'administration.emailIntake.%'`)).n, 0,
      "the Firebase catalog ids are NOT registered (the compatibility admin Role would import them as default grants)");
  });

  const REVIEWER = await persona("reviewer", [...REVIEW, "workOrder.create", "workOrder.lifecycle.cancel"]);
  const REVIEWER_B = await persona("reviewer-b", [...REVIEW, "workOrder.create"]);
  const ACCEPT_ONLY = await persona("accept-no-create", ["inboundWork.request.read", "inboundWork.request.accept"]);
  const READER = await persona("reader", ["inboundWork.request.read"]);
  const ADMIN = await persona("intake-admin", ["inboundWork.intake.manage"]);
  const NOBODY = await persona("nobody", []);

  const call = async (subject, operation, input = {}, state = "ACTIVE") => {
    const res = await handleOperationsRequest({
      reader: repo, pool, ...(state === null ? {} : { workOrderPostgresState: state }),
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "eos" }),
    }, {
      method: "POST", url: INBOUND_WORK_ROUTE,
      headers: { authorization: `Bearer ${subject}`, "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const callWo = async (subject, operation, input = {}) => {
    const res = await handleOperationsRequest({ reader: repo, pool, workOrderPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "eos" }) },
    { method: "POST", url: "/operations/work-orders", headers: { authorization: `Bearer ${subject}` }, body: JSON.stringify({ operation, input }) });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
  const refused = (r, status, code) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.code, code, JSON.stringify(r.body)); };
  const deliver = (fixture, over = {}) => call(ADMIN, "deliverInboundMessage",
    { provider: fixture.provider, mailboxId: fixture.mailboxId, connectionId: SANDBOX_CONNECTION.id, message: fixture.message, ...over });
  const detail = async (requestId) => ok(await call(REVIEWER, "readInboundWorkRequest", { requestId }));
  const woCount = async () => (await one(`SELECT count(*)::int n FROM eos_ops.work_orders`)).n;
  const audits = async (targetId, action) => (await q(
    `SELECT action, actor_uid, target_kind, before, after, reason FROM eos_policy.audit_events WHERE tenant_id = $1 AND target_id = $2
      ${action ? "AND action = $3" : ""} ORDER BY occurred_at, id`, action ? [T, targetId, action] : [T, targetId])).rows;
  const graph = (fixture, patch) => ({ ...fixture, message: { ...fixture.message, ...patch } });

  await t.test("fail-closed: while the Work Order authority is INACTIVE the route answers NOT_ACTIVATED and writes nothing", async () => {
    assert.deepEqual(ok(await call(REVIEWER, "readWorkOrderAuthorityStatus", {}, "INACTIVE")), { postgres: "INACTIVE", readiness: "NOT_YET_ACTIVATED" });
    refused(await call(REVIEWER, "listInboundWork", {}, "INACTIVE"), 503, "NOT_ACTIVATED");
    refused(await call(ADMIN, "deliverInboundMessage", { provider: "MICROSOFT_365", mailboxId: "x", message: {} }, "INACTIVE"), 503, "NOT_ACTIVATED");
    refused(await call(REVIEWER, "acceptInboundWork", {}, "INACTIVE"), 503, "NOT_ACTIVATED");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.inbound_work_requests`)).n, 0);
    refused(await call(REVIEWER, "createWorkOrderFromEmail"), 404, "UNKNOWN_OPERATION");
  });

  await t.test("intake administration: mailboxes and routing rules are governed configuration (inboundWork.intake.manage)", async () => {
    refused(await call(REVIEWER, "saveInboundMailbox", { mailboxId: "m", displayName: "M" }), 403, "CAPABILITY_MISSING");
    for (const mb of SANDBOX_MAILBOX_CONFIGS) {
      const c = mb.config;
      ok(await call(ADMIN, "saveInboundMailbox", {
        mailboxId: mb.id, displayName: c.displayName, emailAddress: c.emailAddress, purpose: c.purpose, destination: c.destination,
        defaultQueue: c.defaultQueue, threadingEnabled: c.threadingEnabled, inboundEnabled: c.inboundEnabled,
        // The warranty mailbox SUGGESTS ventana, so the Accept below proves the reviewer's stated company wins.
        ...(mb.id === SANDBOX_MAILBOXES.warranty ? { suggestedOperatingCompanyId: "ventana" } : {}),
      }));
    }
    for (const rule of SANDBOX_ROUTING_RULES) {
      ok(await call(ADMIN, "saveInboundRoutingRule", { ruleId: rule.id, ...rule.rule }));
    }
    refused(await call(ADMIN, "saveInboundRoutingRule", { ruleId: "bad", name: "Bad", then: { requestType: "FREE_BEER" } }), 400, "RULE_OUTCOME_INVALID");
    refused(await call(ADMIN, "saveInboundRoutingRule", { ruleId: "bad", name: "Bad", when: { subjectRegex: ".*" } }), 400, "RULE_CONDITION_INVALID");
    refused(await call(ADMIN, "saveInboundMailbox", { mailboxId: "m2", displayName: "M2", suggestedOperatingCompanyId: "acme" }), 412, "OPERATING_COMPANY_NOT_GOVERNED");
    const cfg = ok(await call(ADMIN, "readInboundIntakeConfiguration"));
    assert.deepEqual(cfg.mailboxes.map((m) => m.id).sort(), Object.values(SANDBOX_MAILBOXES).sort());
    assert.deepEqual(cfg.rules.map((r) => r.id), ["sbx-rule-corporate-warranty", "sbx-rule-service-mailbox"]);
    assert.equal((await audits(SANDBOX_MAILBOXES.warranty, "inboundWork.mailbox.save")).length, 1);
    refused(await call(ADMIN, "listInboundWork"), 403, "CAPABILITY_MISSING");
    refused(await call(REVIEWER, "deliverInboundMessage", { provider: "MICROSOFT_365", mailboxId: "x", message: {} }), 403, "CAPABILITY_MISSING");
  });

  const warrantyId = inboundRequestId(T, SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);

  await t.test("INTAKE: a Microsoft warranty message creates exactly ONE intake, routed by the administrator's rule", async () => {
    const r = ok(await deliver(FIXTURE_CORPORATE_WARRANTY));
    assert.deepEqual([r.requestId, r.outcome, r.status], [warrantyId, "CREATED", "AWAITING_DECISION"]);
    const d = await detail(warrantyId);
    assert.deepEqual([d.requestType, d.queue, d.routingRuleId, d.routingRuleName, d.priority, d.processingProvider],
      ["WARRANTY", "WARRANTY_REVIEW", "sbx-rule-corporate-warranty", "Corporate warranty requests", 2, "EOS_NATIVE"]);
    assert.equal(d.suggestedOperatingCompanyId, "ventana", "a SUGGESTION from EOS configuration, never from the message");
    assert.equal(d.operatingCompanyId, null, "no company is decided at intake");
    assert.equal((await audits(warrantyId, "inboundWork.request.create")).length, 1);
  });

  await t.test("EVIDENCE: provenance and the original message survive; the read never hands a browser the markup", async () => {
    const d = await detail(warrantyId);
    assert.deepEqual([d.sourceProvider, d.sourceMessageId, d.sourceThreadId, d.sender, d.sourceMailboxName],
      ["MICROSOFT_365", "sbx-msg-warranty-1", "sbx-conv-warranty-1", "dispatch@corporate.example", "Warranty"]);
    assert.equal(d.receivedAt, Date.parse("2026-09-01T15:04:00Z"));
    assert.match(d.originalBodyText, /not cooling/);
    assert.equal(/[<>]/.test(d.originalBodyText), false);
    assert.equal("originalBody" in d, false, "the stored markup is not projected at all");
    const stored = await one(`SELECT original_body, original_body_content_type FROM eos_ops.inbound_work_requests WHERE id = $1`, [warrantyId]);
    assert.match(stored.original_body, /<p>/, "the raw message is retained as evidence");
    assert.equal(stored.original_body_content_type, "text/html");
    assert.deepEqual(d.attachmentRefs.map((a) => [a.filename, a.mimeType, a.size, a.providerAttachmentId, a.sourceMessageId, a.custody]), [
      ["warranty-authorization.pdf", "application/pdf", 20480, "sbx-att-1", "sbx-msg-warranty-1", "METADATA_ONLY"],
      ["unit-photo.jpg", "image/jpeg", 51200, "sbx-att-2", "sbx-msg-warranty-1", "METADATA_ONLY"],
    ]);
  });

  await t.test("EXTRACTION + EXACT-KEY SUGGESTIONS: authorization / reference / model / serial / problem, and the unit by serial", async () => {
    const d = await detail(warrantyId);
    assert.deepEqual([d.authorizationNumber, d.externalReference, d.modelNumber, d.serialNumber],
      ["WR-4471", "CASE-88213", "C712", "SBX-SN-0001"]);
    assert.match(d.problemDescription, /not cooling and the compressor is short cycling/);
    // The stored serial is " sbx-sn-0001 ": matched on the derived key, not the raw text.
    assert.deepEqual(d.equipmentCandidate, { id: R.equipmentId, rawValue: "SBX-SN-0001", confidence: "EXACT", matchedOn: "serialNumberKey" });
    assert.deepEqual([d.customerCandidate.id, d.customerCandidate.matchedOn], [R.accountId, "equipmentAccount"]);
    assert.deepEqual([d.locationCandidate.id, d.locationCandidate.matchedOn], [R.locationId, "equipmentLocation"]);
  });

  await t.test("SUGGESTIONS: a sender address that is exactly one contact suggests its account; an unknown sender suggests NOTHING", async () => {
    const known = ok(await deliver(graph(FIXTURE_UNKNOWN_CUSTOMER, { id: "sbx-msg-contact-1", conversationId: "sbx-conv-contact-1",
      from: { emailAddress: { address: R.contact.email } }, body: { contentType: "HTML", content: "<p>Our fryer will not heat up at all this morning.</p>" } })));
    const k = await detail(known.requestId);
    assert.deepEqual([k.customerCandidate.id, k.customerCandidate.matchedOn, k.equipmentCandidate.id], [R.accountId, "contactEmail", null]);
    const unknown = ok(await deliver(FIXTURE_UNKNOWN_CUSTOMER));
    assert.deepEqual([unknown.outcome, unknown.status], ["CREATED", "NEEDS_REVIEW"], "the service mailbox rule demands manual review");
    const u = await detail(unknown.requestId);
    assert.deepEqual(u.customerCandidate, { id: null, rawValue: "manager@unknown-vendor.example", confidence: "NONE", matchedOn: "" });
    assert.ok(u.warnings.includes("NO_SERIAL_NUMBER"));
  });

  await t.test("DUPLICATE PROTECTION: the same message twice is ONE intake; identical content under a new id is flagged, not merged", async () => {
    const before = (await one(`SELECT count(*)::int n FROM eos_ops.inbound_work_requests`)).n;
    const again = ok(await deliver(FIXTURE_CORPORATE_WARRANTY));
    assert.deepEqual([again.requestId, again.outcome], [warrantyId, "DUPLICATE"]);
    const [a, b] = await Promise.all([deliver(FIXTURE_TO_DECLINE), deliver(FIXTURE_TO_DECLINE)]);
    assert.deepEqual([ok(a).requestId, ok(a).outcome === "CREATED" || ok(a).outcome === "DUPLICATE"], [ok(b).requestId, true]);
    assert.deepEqual([ok(a).outcome, ok(b).outcome].sort(), ["CREATED", "DUPLICATE"], "a racing redelivery converges on one record");
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.inbound_work_requests`)).n, before + 1);
    const copy = ok(await deliver(graph(FIXTURE_TO_DECLINE, { id: "sbx-msg-decline-1-copy", conversationId: "sbx-conv-decline-1-copy" })));
    assert.deepEqual([copy.outcome, copy.status, copy.duplicateOfRequestId], ["CREATED", "NEEDS_REVIEW", ok(a).requestId]);
    assert.match((await detail(copy.requestId)).statusNote, /Identical content/);
  });

  await t.test("THREAD ASSOCIATION: a reply is preserved on the intake it answers -- once -- and ambiguity goes to a person", async () => {
    const reply = ok(await deliver(FIXTURE_WARRANTY_REPLY));
    assert.deepEqual([reply.requestId, reply.outcome], [warrantyId, "THREAD_MATCH"]);
    const again = ok(await deliver(FIXTURE_WARRANTY_REPLY));
    assert.deepEqual([again.requestId, again.outcome], [warrantyId, "DUPLICATE"]);
    const d = await detail(warrantyId);
    assert.deepEqual(d.threadMessages.map((m) => [m.messageId, m.matchedOn]), [["sbx-msg-warranty-1-reply", "providerThreadId"]]);
    assert.match(d.threadMessages[0].normalizedBody, /still down/);
    assert.equal((await audits(warrantyId, "inboundWork.request.linkThreadMessage")).length, 1);
    // References naming TWO different intakes: AMBIGUOUS -> a new intake that NEEDS_REVIEW, naming both.
    const unknownId = inboundRequestId(T, SANDBOX_MAILBOXES.service, FIXTURE_UNKNOWN_CUSTOMER.message.id);
    const declineId = inboundRequestId(T, SANDBOX_MAILBOXES.service, FIXTURE_TO_DECLINE.message.id);
    const amb = ok(await deliver(graph(FIXTURE_UNKNOWN_CUSTOMER, { id: "sbx-msg-ambiguous", conversationId: "sbx-conv-ambiguous",
      body: { contentType: "HTML", content: "<p>Following up on both of these jobs please.</p>" },
      internetMessageHeaders: [{ name: "References", value: `${FIXTURE_UNKNOWN_CUSTOMER.message.id} ${FIXTURE_TO_DECLINE.message.id}` }] })));
    assert.deepEqual([amb.outcome, amb.status], ["AMBIGUOUS", "NEEDS_REVIEW"]);
    assert.deepEqual((await detail(amb.requestId)).threadAssociationCandidateIds.sort(), [unknownId, declineId].sort());
  });

  await t.test("QUARANTINE: an unknown or disabled mailbox is retained as QUARANTINED, audited, and cannot be decided", async () => {
    const stray = graph(FIXTURE_GMAIL_SERVICE, { id: "sbx-gmail-stray", threadId: "sbx-gthread-stray" });
    const q1 = ok(await deliver(stray, { mailboxId: "sbx-mb-nowhere" }));
    assert.deepEqual([q1.outcome, q1.status], ["QUARANTINED", "QUARANTINED"]);
    const d = await detail(q1.requestId);
    assert.match(d.statusNote, /does not know/);
    assert.match(d.originalBodyText, /ice machine is leaking/, "the message is retained, not discarded");
    assert.equal((await audits(q1.requestId, "inboundWork.request.quarantine")).length, 1);
    refused(await call(REVIEWER, "acceptInboundWork", { requestId: q1.requestId, operatingCompanyId: "taylor", customerId: R.accountId, locationId: R.locationId }),
      412, "ALREADY_DECIDED");
    ok(await call(ADMIN, "saveInboundMailbox", { mailboxId: SANDBOX_MAILBOXES.parts, displayName: "Parts", purpose: "PARTS", destination: "PARTS", status: "DISABLED" }));
    const q2 = ok(await deliver(graph(FIXTURE_UNKNOWN_CUSTOMER, { id: "sbx-msg-parts-1", conversationId: "sbx-conv-parts-1" }), { mailboxId: SANDBOX_MAILBOXES.parts }));
    assert.equal(q2.status, "QUARANTINED");
    assert.match((await detail(q2.requestId)).statusNote, /not accepting/);
    assert.equal(ok(await deliver(stray, { mailboxId: "sbx-mb-nowhere" })).outcome, "DUPLICATE", "a quarantined redelivery is still one record");
  });

  await t.test("FAILED: a processing provider that throws leaves a RETAINED FAILED intake carrying the failure", async () => {
    const message = normalizeProviderMessage("MICROSOFT_365", { ...FIXTURE_UNKNOWN_CUSTOMER.message, id: "sbx-msg-fail-1", conversationId: "sbx-conv-fail-1",
      body: { contentType: "HTML", content: "<p>A request whose processing will fail.</p>" } }, { connectionId: SANDBOX_CONNECTION.id, mailboxId: SANDBOX_MAILBOXES.service });
    const actor = { tenantId: T, principalId: principalIds[ADMIN], capabilities: new Set(["inboundWork.intake.manage"]) };
    const out = await ingestInboundMessage({ pool }, actor, { message, processingProvider: "EXTERNAL",
      providerResult: Object.defineProperty({}, "requestType", { enumerable: true, get() { throw new Error("provider exploded"); } }) });
    assert.deepEqual([out.outcome, out.status], ["FAILED", "FAILED"]);
    const d = await detail(out.requestId);
    assert.equal(d.processingError, "provider exploded");
    assert.equal((await audits(out.requestId, "inboundWork.request.fail")).length, 1);
    await assert.rejects(ingestInboundMessage({ pool }, { ...actor, capabilities: new Set() }, { message }),
      (e) => e instanceof InboundWorkError && e.code === "CAPABILITY_MISSING");
  });

  await t.test("REVIEW: the queue and the caller's own decision set", async () => {
    const queue = ok(await call(READER, "listInboundWork", { statuses: ["AWAITING_DECISION", "NEEDS_REVIEW"] }));
    assert.ok(queue.rows.some((r) => r.id === warrantyId && r.status === "AWAITING_DECISION" && r.attachmentCount === 2));
    assert.ok(queue.rows.every((r) => ["AWAITING_DECISION", "NEEDS_REVIEW"].includes(r.status)));
    refused(await call(NOBODY, "listInboundWork"), 403, "CAPABILITY_MISSING");
    refused(await call(NOBODY, "readInboundWorkRequest", { requestId: warrantyId }), 403, "CAPABILITY_MISSING");
    refused(await call(READER, "readInboundWorkRequest", { requestId: "inbound_nope" }), 404, "INBOUND_REQUEST_NOT_FOUND");
    assert.deepEqual(ok(await call(REVIEWER, "readInboundWorkAccess")), { canRead: true, canAccept: true, canDecline: true, canAttach: true, canManageIntake: false });
    assert.deepEqual(ok(await call(ACCEPT_ONLY, "readInboundWorkAccess")), { canRead: true, canAccept: false, canDecline: false, canAttach: false, canManageIntake: false },
      "Accept without workOrder.create is no Accept at all");
    assert.deepEqual(ok(await call(NOBODY, "readInboundWorkAccess")), { canRead: false, canAccept: false, canDecline: false, canAttach: false, canManageIntake: false });
  });

  let acceptedWo;
  await t.test("ACCEPT -> the governed EOS Work Order create: refusals first, nothing written", async () => {
    const base = { requestId: warrantyId, operatingCompanyId: "taylor", customerId: R.accountId, locationId: R.locationId };
    const n = await woCount();
    refused(await call(NOBODY, "acceptInboundWork", base), 403, "CAPABILITY_MISSING");
    refused(await call(READER, "acceptInboundWork", base), 403, "CAPABILITY_MISSING");
    const noCreate = await call(ACCEPT_ONLY, "acceptInboundWork", base);
    refused(noCreate, 403, "CAPABILITY_MISSING");
    assert.match(noCreate.body.message, /workOrder\.create/);
    const { operatingCompanyId: _o, ...noCompany } = base;
    refused(await call(REVIEWER, "acceptInboundWork", noCompany), 400, "OPERATING_COMPANY_REQUIRED");
    refused(await call(REVIEWER, "acceptInboundWork", { ...base, locationId: "sbx-loc-other" }), 400, "LOCATION_CUSTOMER_MISMATCH");
    refused(await call(REVIEWER, "acceptInboundWork", { ...base, customerId: "sbx-acct-nope" }), 404, "CUSTOMER_NOT_FOUND");
    refused(await call(REVIEWER, "acceptInboundWork", { ...base, equipmentId: R.equipmentId, requestType: "INSTALL" }), 400, "EQUIPMENT_NOT_ALLOWED_FOR_TYPE");
    refused(await call(REVIEWER, "acceptInboundWork", { ...base, operatingCompanyIdOverride: "x" }), 400, "INPUT_FIELD_NOT_ACCEPTED");
    // A create that FAILS (an ACTIVE but unkeyed company) releases the claim: the intake is decidable again.
    refused(await call(REVIEWER, "acceptInboundWork", { ...base, operatingCompanyId: "unkeyed-co" }), 503, "OPERATING_COMPANY_KEY_NOT_BOUND");
    assert.equal((await detail(warrantyId)).status, "AWAITING_DECISION");
    assert.equal(await woCount(), n);
  });

  await t.test("ACCEPT creates exactly ONE Work Order with the STATED company; every replay returns it", async () => {
    const n = await woCount();
    const input = { requestId: warrantyId, operatingCompanyId: "taylor", customerId: R.accountId, locationId: R.locationId, equipmentId: R.equipmentId };
    const first = ok(await call(REVIEWER, "acceptInboundWork", input));
    assert.equal(first.replayed, false);
    assert.match(first.workOrderNumber, /^WO-\d{4}-\d{6}$/);
    acceptedWo = first.workOrderId;
    const wo = await one(`SELECT * FROM eos_ops.work_orders WHERE id = $1`, [acceptedWo]);
    assert.deepEqual([wo.operating_company_key, wo.status, wo.work_order_type, wo.priority, wo.customer_id, wo.location_id, wo.equipment_id, wo.provenance],
      ["taylor", "CREATED", "WARRANTY", 2, R.accountId, R.locationId, R.equipmentId, "NATIVE"],
      "the reviewer's company (taylor), not the mailbox's suggestion (ventana); type from the routed WARRANTY; priority from the rule");
    assert.match(wo.complaint, /not cooling/, "no re-typing: the problem the message described");
    assert.equal(wo.create_idempotency_key, acceptIdempotencyKey(warrantyId));
    const again = ok(await call(REVIEWER, "acceptInboundWork", input));
    const otherReviewer = ok(await call(REVIEWER_B, "acceptInboundWork", { ...input, operatingCompanyId: "ventana" }));
    assert.deepEqual([again.replayed, again.workOrderId, otherReviewer.replayed, otherReviewer.workOrderId], [true, acceptedWo, true, acceptedWo]);
    assert.equal(await woCount(), n + 1, "two clicks, two reviewers: one Work Order");
    const d = await detail(warrantyId);
    assert.deepEqual([d.status, d.decision, d.workItemId, d.workOrderNumber, d.operatingCompanyId, d.suggestedOperatingCompanyId, d.workOrderLinkKind, d.decisionBy],
      ["ACCEPTED", "ACCEPTED", acceptedWo, first.workOrderNumber, "taylor", "ventana", "CREATED_BY_ACCEPT", principalIds[REVIEWER]]);
    const link = await one(`SELECT * FROM eos_ops.inbound_work_order_links WHERE request_id = $1`, [warrantyId]);
    assert.deepEqual([link.work_order_id, link.external_reference, link.authorization_number], [acceptedWo, "CASE-88213", "WR-4471"]);
    const accepted = await audits(warrantyId, "inboundWork.request.accept");
    assert.equal(accepted.length, 1);
    assert.deepEqual([accepted[0].actor_uid, accepted[0].after.operatingCompanyId, accepted[0].after.suggestedOperatingCompanyId], [principalIds[REVIEWER], "taylor", "ventana"]);
    assert.equal(link.audit_event_id !== null, true);
    const woEvents = await audits(acceptedWo, "workOrder.createFromInboundWork");
    assert.deepEqual([woEvents.length, woEvents[0].after.inboundWorkRequestId], [1, warrantyId]);
    refused(await call(REVIEWER, "declineInboundWork", { requestId: warrantyId, reason: "OTHER" }), 412, "ALREADY_DECIDED");
    refused(await call(REVIEWER, "attachInboundWork", { requestId: warrantyId, workOrderId: acceptedWo }), 412, "ALREADY_DECIDED");
  });

  await t.test("ACCEPT under a race: two reviewers at once still make ONE Work Order", async () => {
    const id = inboundRequestId(T, SANDBOX_MAILBOXES.service, "sbx-msg-contact-1");
    const n = await woCount();
    const input = { requestId: id, operatingCompanyId: "taylor", customerId: R.accountId, locationId: R.locationId, problemDescription: "Fryer will not heat" };
    const results = await Promise.all([call(REVIEWER, "acceptInboundWork", input), call(REVIEWER_B, "acceptInboundWork", input)]);
    assert.equal(await woCount(), n + 1);
    const wins = results.filter((r) => r.status === 200);
    assert.ok(wins.length >= 1);
    for (const r of results.filter((x) => x.status !== 200)) refused(r, 409, "ACCEPT_IN_PROGRESS");
    assert.equal(new Set(wins.map((w) => w.body.result.workOrderId)).size, 1);
    const wo = await one(`SELECT complaint, work_order_type FROM eos_ops.work_orders WHERE id = $1`, [wins[0].body.result.workOrderId]);
    assert.deepEqual([wo.complaint, wo.work_order_type], ["Fryer will not heat", "SERVICE_CALL"], "the reviewer's correction; SERVICE -> SERVICE_CALL");
  });

  await t.test("ACCEPT after a crash between the create and the record: the claimant's retry converges on the SAME Work Order", async () => {
    const id = inboundRequestId(T, SANDBOX_MAILBOXES.service, "sbx-msg-decline-1-copy");
    // Simulate the crash: claim held by REVIEWER, the governed create already committed under the derived key.
    await q(`UPDATE eos_ops.inbound_work_requests SET status = 'ACCEPTING', accept_claimed_by_principal_id = $2, accept_claim_prior_status = status WHERE id = $1`,
      [id, principalIds[REVIEWER]]);
    const input = { requestId: id, operatingCompanyId: "taylor", customerId: R.accountId, locationId: R.locationId };
    const { createWorkOrder } = require("../lib/eosOps/workOrderCreateCommand.js");
    const pre = await createWorkOrder({ pool }, { tenantId: T, principalId: principalIds[REVIEWER], capabilities: new Set(["workOrder.create"]), operatingCompanyId: "taylor" },
      { customerId: R.accountId, locationId: R.locationId, workOrderType: "SERVICE_CALL", priority: 3,
        complaint: (await detail(id)).problemDescription, idempotencyKey: acceptIdempotencyKey(id) });
    const n = await woCount();
    refused(await call(REVIEWER_B, "acceptInboundWork", input), 409, "ACCEPT_IN_PROGRESS");
    const resumed = ok(await call(REVIEWER, "acceptInboundWork", input));
    assert.deepEqual([resumed.workOrderId, resumed.replayed], [pre.workOrderId, true]);
    assert.equal(await woCount(), n, "no second Work Order");
    assert.equal((await detail(id)).status, "ACCEPTED");
  });

  await t.test("DECLINE is a governed, retained state with a governed reason", async () => {
    const id = inboundRequestId(T, SANDBOX_MAILBOXES.service, FIXTURE_TO_DECLINE.message.id);
    refused(await call(REVIEWER, "declineInboundWork", { requestId: id, reason: "BORED" }), 400, "DECLINE_REASON_REQUIRED");
    refused(await call(READER, "declineInboundWork", { requestId: id, reason: "OTHER" }), 403, "CAPABILITY_MISSING");
    const out = ok(await call(REVIEWER, "declineInboundWork", { requestId: id, reason: "OUTSIDE_SERVICE_AREA", note: "four states away" }));
    assert.equal(out.replayed, false);
    assert.equal(ok(await call(REVIEWER_B, "declineInboundWork", { requestId: id, reason: "OUTSIDE_SERVICE_AREA" })).replayed, true);
    const d = await detail(id);
    assert.deepEqual([d.status, d.decision, d.decisionReason, d.decisionNote, d.workItemId], ["DECLINED", "DECLINED", "OUTSIDE_SERVICE_AREA", "four states away", null]);
    const ev = await audits(id, "inboundWork.request.decline");
    assert.deepEqual([ev.length, ev[0].reason, ev[0].after.note], [1, "OUTSIDE_SERVICE_AREA", "four states away"]);
    refused(await call(REVIEWER, "acceptInboundWork", { requestId: id, operatingCompanyId: "taylor", customerId: R.accountId, locationId: R.locationId }), 412, "ALREADY_DECIDED");
    await assert.rejects(q(`DELETE FROM eos_ops.inbound_work_requests WHERE id = $1`, [id]), /retained/);
  });

  await t.test("ATTACH files the intake against an existing, non-terminal EOS Work Order -- and creates none", async () => {
    const gmail = ok(await deliver(FIXTURE_GMAIL_SERVICE));
    assert.equal(gmail.outcome, "CREATED");
    const g = await detail(gmail.requestId);
    assert.deepEqual([g.sourceProvider, g.externalReference, g.equipmentCandidate.id], ["GOOGLE_WORKSPACE", "VEN-5512", R.equipmentId], "Gmail parity");
    const n = await woCount();
    refused(await call(READER, "attachInboundWork", { requestId: gmail.requestId, workOrderId: acceptedWo }), 403, "CAPABILITY_MISSING");
    refused(await call(REVIEWER, "attachInboundWork", { requestId: gmail.requestId, workOrderId: "wo_missing" }), 404, "WORK_ORDER_NOT_FOUND");
    const doomed = ok(await callWo(REVIEWER, "createWorkOrder",
      { operatingCompanyId: "taylor", customerId: "sbx-acct-other", locationId: "sbx-loc-other", workOrderType: "SERVICE_CALL", priority: 3 }));
    ok(await callWo(REVIEWER, "cancelWorkOrder", { workOrderId: doomed.workOrderId, expectedStatus: "CREATED", note: "fixture" }));
    refused(await call(REVIEWER, "attachInboundWork", { requestId: gmail.requestId, workOrderId: doomed.workOrderId }), 412, "WORK_ORDER_TERMINAL");
    const out = ok(await call(REVIEWER, "attachInboundWork", { requestId: gmail.requestId, workOrderId: acceptedWo }));
    assert.deepEqual([out.workOrderId, out.replayed], [acceptedWo, false]);
    assert.equal(ok(await call(REVIEWER_B, "attachInboundWork", { requestId: gmail.requestId, workOrderId: acceptedWo })).replayed, true);
    assert.equal(await woCount(), n + 1, "only the fixture Work Order above; attach created none");
    const d = await detail(gmail.requestId);
    assert.deepEqual([d.status, d.workItemId, d.customerId, d.customerLocationId, d.workOrderLinkKind], ["ATTACHED", acceptedWo, R.accountId, R.locationId, "ATTACHED"],
      "the Work Order is the authority on who the request is for");
    assert.equal((await audits(gmail.requestId, "inboundWork.request.attach")).length, 1);
    assert.equal((await one(`SELECT count(*)::int n FROM eos_ops.inbound_work_order_links WHERE work_order_id = $1`, [acceptedWo])).n, 2);
  });

  await t.test("APPEND-ONLY: message evidence and Work Order links cannot be edited or removed", async () => {
    await assert.rejects(q(`UPDATE eos_ops.inbound_work_messages SET subject = 'x'`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_ops.inbound_work_messages`), /append-only/);
    await assert.rejects(q(`UPDATE eos_ops.inbound_work_order_links SET work_order_id = work_order_id`), /append-only/);
    await assert.rejects(q(`UPDATE eos_policy.audit_events SET reason = 'x' WHERE target_id = $1`, [warrantyId]));
    const actors = (await q(`SELECT DISTINCT actor_uid FROM eos_policy.audit_events WHERE tenant_id = $1 AND action LIKE 'inboundWork.%'`, [T])).rows.map((r) => r.actor_uid);
    assert.ok(actors.every((a) => Object.values(principalIds).includes(a)), "every inbound audit event names an EOS Principal");
  });
});
