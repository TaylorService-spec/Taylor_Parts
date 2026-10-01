// INBOUND WORK RECOVERY -- RELEASE / REASSIGN (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment B --
// "ACCEPTANCE -- RECOVERY").
//
// On a BASELINE-EQUAL tenant carrying the accepted live Service authority (support/serviceBaselineTenant.mjs), with the
// ruled recovery grant (fieldManager -> inboundWorkRequest/recover) applied through the Administration API, as signed-in
// principals holding CANONICAL Security Roles, through the real transport:
//
//   Dispatcher accepts an item; the Accept is interrupted (a crash is simulated at the exact statement, the rest of the
//   code is the shipped path) -> the claim is stuck; another reviewer is refused ACCEPT_IN_PROGRESS.
//   The Dispatcher cannot use recovery (not granted). Office Manager, Technician, Sales: refused.
//   The Service Manager RELEASES it -> history preserved; the Work Order the Dispatcher's create already committed is
//   CARRIED; another eligible reviewer accepts it and gets THAT Work Order -- never a second one.
//   The Service Manager REASSIGNS a second stuck item to another eligible reviewer (by Employee) -> original and new
//   reviewer history preserved; ineligible / unauthorized / raw-Principal targets fail closed.
//   A PARTS-routed item is refused (RECOVERY_OUTSIDE_SERVICE_DOMAIN); a decided item is refused (RECOVERY_NOT_APPLICABLE).
//   History is append-only.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";

const require = createRequire(import.meta.url);
const delta = require("../lib/adminPolicy/serviceActivationAuthorityDelta.js");
const { INBOUND_WORK_ROUTE } = require("../lib/eosOps/inboundWorkOperations.js");
const decisions = require("../lib/eosOps/inboundWorkDecisions.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const TENANT = "t-recovery";

const graph = (id, subject, body) => ({
  id, conversationId: `conv-${id}`, internetMessageId: `<${id}@vendor.example>`, receivedDateTime: "2026-09-30T14:00:00Z", subject,
  from: { emailAddress: { address: `ops-${id}@vendor.example` } }, toRecipients: [{ emailAddress: { address: "service@taylor.example" } }],
  body: { contentType: "HTML", content: body }, internetMessageHeaders: [], attachments: [],
});

/**
 * A pool whose client dies at one exact statement -- the shipped Accept path runs unchanged up to it. `after` names the
 * statement the process dies AT (it is never executed), simulating the crash between two committed steps.
 */
function crashingPool(pool, dieAt) {
  const wrap = (client) => new Proxy(client, {
    get(target, prop) {
      if (prop === "query") {
        return (sql, ...rest) => {
          if (typeof sql === "string" && dieAt.some((re) => re.test(sql))) return Promise.reject(Object.assign(new Error("simulated process death"), { code: "SIMULATED_CRASH" }));
          return target.query(sql, ...rest);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === "connect") return async () => wrap(await target.connect());
      if (prop === "query") return (sql, ...rest) => (dieAt.some((re) => re.test(sql)) ? Promise.reject(Object.assign(new Error("simulated process death"), { code: "SIMULATED_CRASH" })) : target.query(sql, ...rest));
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

test("static: the ruled recovery grant is exactly one, to the Service Manager", () => {
  const ops = delta.serviceExperienceOperations();
  assert.deepEqual(ops.map((o) => [o.operation, o.input.roleKey, o.input.objectKey, o.input.actionKey]),
    [["grantObjectActionToRole", "fieldManager", "inboundWorkRequest", "recover"]]);
});

test("Inbound Work recovery through /operations/inbound-work", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { q, admin, person, call, pool } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: TENANT, prefix: "iwrec" });
  const iw = (who, op, input) => call(who, INBOUND_WORK_ROUTE, op, input);
  const ok = (r, what = "") => { assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`); return r.body.result; };
  const refused = (r, status, code, what = "") => assert.deepEqual([r.status, r.body.code], [status, code], `${what} ${JSON.stringify(r.body)}`);
  const one = async (sql, v = []) => (await q(sql, v)).rows[0];

  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-r',$1,'Summit Grill','ACTIVE','f','f')`, [TENANT]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ('loc-r',$1,'acct-r','Summit Kitchen','f','f')`, [TENANT]);

  const sm = await person("uid-rec-sm", ["fieldManager"], { id: "emp-rec-sm", name: "Sam Manager" });
  const disp = await person("uid-rec-disp", ["dispatcher"], { id: "emp-rec-disp", name: "Dana Dispatch" });
  const disp2 = await person("uid-rec-disp2", ["dispatcher"], { id: "emp-rec-disp2", name: "Drew Dispatch" });
  const office = await person("uid-rec-office", ["officeManager"], { id: "emp-rec-office", name: "Olive Office" });
  const tech = await person("uid-rec-tech", ["technician"], { id: "emp-rec-tech", name: "Tia Tech", technician: true });
  const sales = await person("uid-rec-sales", ["salesperson"]);
  await person("uid-rec-leave", ["dispatcher"], { id: "emp-rec-leave", name: "Lee Leave", status: "ON_LEAVE" });
  await person("uid-rec-unlinked", ["dispatcher"], { id: "emp-rec-unlinked", name: "Una Unlinked", linked: false });

  // THE RULED GRANT, through Administration -- the only way authority is given.
  for (const { operation, input } of delta.serviceExperienceOperations()) assert.equal((await admin(operation, input)).ok, true);

  // Intake: the Service Manager administers intake (inboundWork.intake.manage, accepted live grant).
  ok(await iw(sm, "saveInboundMailbox", { mailboxId: "mb-service", displayName: "Service", emailAddress: "service@taylor.example", purpose: "SERVICE", destination: "SERVICE" }));
  ok(await iw(sm, "saveInboundMailbox", { mailboxId: "mb-parts", displayName: "Parts", emailAddress: "parts@taylor.example", purpose: "PARTS", destination: "PARTS" }));
  const deliver = async (mailboxId, id, subject) => ok(await iw(sm, "deliverInboundMessage",
    { provider: "MICROSOFT_365", mailboxId, message: graph(id, subject, `<p>Problem: ${subject}</p>`) })).requestId;
  const item1 = await deliver("mb-service", "rec-1", "walk-in freezer icing");
  const item2 = await deliver("mb-service", "rec-2", "fryer will not heat");
  const itemParts = await deliver("mb-parts", "rec-3", "need a gasket");

  const dispActor = { tenantId: TENANT, principalId: disp.principalId, capabilities: new Set(["inboundWork.request.accept", "workOrder.create", "inboundWork.request.read"]) };
  const ACCEPT = (requestId) => ({ requestId, operatingCompanyId: "taylor", customerId: "acct-r", locationId: "loc-r" });
  const woCount = async () => (await one(`SELECT count(*)::int n FROM eos_ops.work_orders`)).n;

  let carriedWo;
  await t.test("STUCK: the Dispatcher accepts item 1; the process dies after the Work Order create, before the record", async () => {
    await assert.rejects(decisions.acceptInboundWork({ pool: crashingPool(pool, [/SET status = 'ACCEPTED'/]) }, dispActor, ACCEPT(item1)),
      (e) => e.code === "SIMULATED_CRASH");
    const r = await one(`SELECT status, accept_claimed_by_principal_id, accept_claimed_at FROM eos_ops.inbound_work_requests WHERE id = $1`, [item1]);
    assert.deepEqual([r.status, r.accept_claimed_by_principal_id], ["ACCEPTING", disp.principalId]);
    assert.ok(r.accept_claimed_at);
    assert.equal(await woCount(), 1, "the create had committed");
    carriedWo = (await one(`SELECT id FROM eos_ops.work_orders WHERE created_by_principal_id = $1`, [disp.principalId])).id;
    refused(await iw(disp2, "acceptInboundWork", ACCEPT(item1)), 409, "ACCEPT_IN_PROGRESS", "another reviewer is locked out");
  });

  await t.test("AUTHORITY: the Dispatcher cannot recover (not granted); Office Manager, Technician and Sales are refused", async () => {
    for (const who of [disp, disp2, office, tech, sales]) {
      refused(await iw(who, "releaseInboundWork", { requestId: item1, reason: "stuck" }), 403, "CAPABILITY_MISSING", who.subject);
      refused(await iw(who, "reassignInboundWork", { requestId: item1, employeeId: "emp-rec-disp2", reason: "stuck" }), 403, "CAPABILITY_MISSING", who.subject);
    }
    assert.equal(ok(await iw(sm, "readInboundWorkAccess")).canRecover, true);
    assert.equal(ok(await iw(disp, "readInboundWorkAccess")).canRecover, false);
  });

  await t.test("RELEASE: the Service Manager releases item 1 -> queue; history preserved; the committed Work Order is CARRIED, never duplicated", async () => {
    refused(await iw(sm, "releaseInboundWork", { requestId: item1 }), 400, "RECOVERY_REASON_REQUIRED");
    const rel = ok(await iw(sm, "releaseInboundWork", { requestId: item1, reason: "Dana's session ended mid-accept" }));
    assert.deepEqual([rel.status, rel.releasedFrom, rel.carriedWorkOrderId], ["NEEDS_REVIEW", disp.principalId, carriedWo]);
    const queue = ok(await iw(disp2, "listInboundWork", { statuses: ["NEEDS_REVIEW"] }));
    assert.equal(queue.rows.find((x) => x.id === item1).claimedByPrincipalId, null, "back in the available queue");

    const done = ok(await iw(disp2, "acceptInboundWork", ACCEPT(item1)));
    assert.equal(done.workOrderId, carriedWo, "the next reviewer links the Work Order already created -- not a second one");
    assert.equal(await woCount(), 1);
    const d = ok(await iw(disp2, "readInboundWorkRequest", { requestId: item1 }));
    assert.deepEqual([d.status, d.decisionBy, d.workOrderId], ["ACCEPTED", disp2.principalId, carriedWo]);
    assert.deepEqual(d.claimHistory.map((e) => [e.kind, e.fromPrincipalId, e.toPrincipalId, e.actorPrincipalId]), [
      ["CLAIMED", null, disp.principalId, disp.principalId],
      ["RELEASED", disp.principalId, null, sm.principalId],
      ["CLAIMED", null, disp2.principalId, disp2.principalId],
      ["COMPLETED", disp2.principalId, null, disp2.principalId],
    ]);
    assert.equal(d.claimHistory[0].toName, "Dana Dispatch", "the original reviewer is named");
    assert.equal(d.claimHistory[1].reason, "Dana's session ended mid-accept");
    assert.equal(d.claimHistory[1].carriedWorkOrderId, carriedWo);
    assert.equal(d.claimHistory[3].carriedWorkOrderId, carriedWo);
    const audits = (await q(`SELECT action FROM eos_policy.audit_events WHERE target_id = $1 ORDER BY occurred_at, id`, [item1])).rows.map((r) => r.action);
    assert.ok(audits.includes("inboundWork.request.release") && audits.includes("inboundWork.request.accept"));
  });

  await t.test("REASSIGN: item 2 stuck before any create -> reassigned by Employee; ineligible, unauthorized and raw-Principal targets fail closed", async () => {
    await assert.rejects(decisions.acceptInboundWork({ pool: crashingPool(pool, [/INSERT INTO eos_ops\.work_orders/, /SET status = accept_claim_prior_status/]) },
      dispActor, ACCEPT(item2)), (e) => e.code === "SIMULATED_CRASH");
    assert.equal((await one(`SELECT status FROM eos_ops.inbound_work_requests WHERE id = $1`, [item2])).status, "ACCEPTING");
    const before = await woCount();

    const targets = ok(await iw(sm, "listInboundRecoveryTargets", { requestId: item2 })).targets.map((x) => x.employeeId).sort();
    assert.deepEqual(targets, ["emp-rec-disp2", "emp-rec-sm"], "eligible Employees whose Principal may accept -- not the claimant, on-leave, unlinked, technician or office");
    assert.equal(JSON.stringify(targets).includes("uid-"), false);

    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-disp2" }), 400, "RECOVERY_REASON_REQUIRED");
    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-leave", reason: "x" }), 412, "REVIEWER_NOT_ELIGIBLE", "on leave");
    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-unlinked", reason: "x" }), 412, "REVIEWER_NOT_ELIGIBLE", "unlinked");
    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: disp2.principalId, reason: "x" }), 412, "REVIEWER_NOT_ELIGIBLE", "a raw Principal id");
    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-tech", reason: "x" }), 412, "REVIEWER_NOT_AUTHORIZED", "cannot accept");
    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-office", reason: "x" }), 412, "REVIEWER_NOT_AUTHORIZED", "read only");
    refused(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-disp", reason: "x" }), 412, "REVIEWER_UNCHANGED");

    const moved = ok(await iw(sm, "reassignInboundWork", { requestId: item2, employeeId: "emp-rec-disp2", reason: "Dana is off shift" }));
    assert.deepEqual([moved.status, moved.reassignedFrom, moved.reassignedToEmployeeId, moved.carriedWorkOrderId],
      ["ACCEPTING", disp.principalId, "emp-rec-disp2", null]);
    refused(await iw(disp, "acceptInboundWork", ACCEPT(item2)), 409, "ACCEPT_IN_PROGRESS", "the original reviewer no longer holds it");
    const done = ok(await iw(disp2, "acceptInboundWork", ACCEPT(item2)));
    assert.equal(await woCount(), before + 1, "exactly one Work Order for item 2");
    const d = ok(await iw(disp2, "readInboundWorkRequest", { requestId: item2 }));
    assert.deepEqual(d.claimHistory.map((e) => [e.kind, e.fromPrincipalId, e.toPrincipalId, e.toEmployeeId, e.actorPrincipalId]), [
      ["CLAIMED", null, disp.principalId, null, disp.principalId],
      ["REASSIGNED", disp.principalId, disp2.principalId, "emp-rec-disp2", sm.principalId],
      ["COMPLETED", disp2.principalId, null, null, disp2.principalId],
    ]);
    assert.deepEqual([d.claimHistory[1].fromName, d.claimHistory[1].toName, d.claimHistory[1].reason], ["Dana Dispatch", "Drew Dispatch", "Dana is off shift"]);
    assert.equal(done.workOrderId, d.workOrderId);
  });

  await t.test("BOUNDARIES: a PARTS-routed item is outside Service recovery; a decided item is not a claim; history is append-only", async () => {
    await assert.rejects(decisions.acceptInboundWork({ pool: crashingPool(pool, [/INSERT INTO eos_ops\.work_orders/, /SET status = accept_claim_prior_status/]) },
      dispActor, ACCEPT(itemParts)), (e) => e.code === "SIMULATED_CRASH");
    refused(await iw(sm, "releaseInboundWork", { requestId: itemParts, reason: "x" }), 403, "RECOVERY_OUTSIDE_SERVICE_DOMAIN");
    refused(await iw(sm, "reassignInboundWork", { requestId: itemParts, employeeId: "emp-rec-disp2", reason: "x" }), 403, "RECOVERY_OUTSIDE_SERVICE_DOMAIN");
    refused(await iw(sm, "releaseInboundWork", { requestId: item1, reason: "x" }), 412, "RECOVERY_NOT_APPLICABLE", "ACCEPTED is a decision");
    await assert.rejects(q(`UPDATE eos_ops.inbound_work_claim_events SET reason = 'rewritten'`), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_ops.inbound_work_claim_events`), /append-only/);
  });

  await t.test("VISIBILITY: the queue shows reviewer, age, mailbox, duplicate/thread and quarantine state", async () => {
    const queue = ok(await iw(office, "listInboundWork", {}));
    const parts = queue.rows.find((x) => x.id === itemParts);
    assert.deepEqual([parts.status, parts.claimedByEmployeeId, parts.claimedByName, parts.sourceMailboxName, parts.destination],
      ["ACCEPTING", "emp-rec-disp", "Dana Dispatch", "Parts", "SERVICE"]);
    // Unrouted mail defaults to the SERVICE destination (existing routing parity); the Parts MAILBOX is what makes it Parts intake.
    assert.ok(parts.claimedAt > 0 && parts.createdAt > 0);
    refused(await iw(office, "acceptInboundWork", ACCEPT(item2)), 403, "CAPABILITY_MISSING", "Office Manager read/review is unchanged");
  });
});
