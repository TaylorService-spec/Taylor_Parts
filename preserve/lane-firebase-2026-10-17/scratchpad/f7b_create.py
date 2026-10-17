from ed import edit
F = "D:/eos-fb-exit/functions/"
edit(F + "src/eosCrm/crmActivityAuthority.ts", [
("""//   * CREATE requires crm.activity.create and an Account in this tenant.""",
"""//   * CREATE requires crm.activity.create AND the same Account visibility as the read (customer.record.read, the Account in
//     this tenant): an activity cannot be written to an Account the writer could not read (Owner review, 2026-10-17). Every
//     linked Contact / Opportunity / Sales Order must exist IN THIS TENANT and belong to THAT Account; one outside the
//     tenant, or on another Account, is refused exactly like an unknown one. (The Firestore command checked neither.)
//   * EXPLICIT PARITY NOTE: a principal holding crmActivityContributor ALONE (no customer.record.read) can no longer read or
//     create activity through the API. No customer-read grant is added to compensate (DECISIONS #243)."""),
("""/** Record one interaction. `{ success: true, replayed, activityId }`, exactly the Firestore callable's answer. */
export function createAccountActivity(deps: CrmDeps, actor: CrmActorContext, input: unknown) {
  return runCrmCommand(deps, actor, CRM_ACTIVITY_CREATE,""",
"""/** Each stated reference must be in this tenant AND on this Account; anything else answers like an unknown record. */
const LINKS = Object.freeze([
  ["contactId", "eos_crm.contacts", "CONTACT_NOT_FOUND", "no such Contact on this Account"],
  ["opportunityId", "eos_commercial.opportunities", "OPPORTUNITY_NOT_FOUND", "no such Opportunity on this Account"],
  ["salesOrderId", "eos_commercial.sales_orders", "SALES_ORDER_NOT_FOUND", "no such Sales Order on this Account"],
] as const);

/** Record one interaction. `{ success: true, replayed, activityId }`, exactly the Firestore callable's answer. */
export function createAccountActivity(deps: CrmDeps, actor: CrmActorContext, input: unknown) {
  // Account visibility first: the writer must be able to read the Account it writes to.
  if (actor && actor.capabilities instanceof Set && actor.capabilities.has(CRM_ACTIVITY_CREATE)
      && !actor.capabilities.has(CRM_CAPABILITIES.CUSTOMER_RECORD_READ)) {
    fail("CAPABILITY_REQUIRED", "FORBIDDEN", `recording CRM activity also requires ${CRM_CAPABILITIES.CUSTOMER_RECORD_READ}`);
  }
  return runCrmCommand(deps, actor, CRM_ACTIVITY_CREATE,"""),
("""    async (client, a, p) => {
      await requireTenantAccount(client, a.tenantId, p.accountId);""",
"""    async (client, a, p) => {
      await requireTenantAccount(client, a.tenantId, p.accountId);
      for (const [field, table, code, message] of LINKS) {
        const id = p[field];
        if (id === null) continue;
        const found = await client.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND id = $2 AND account_id = $3`, [a.tenantId, id, p.accountId]);
        if (found.rows.length === 0) fail(code, "NOT_FOUND", message);
      }"""),
])

edit(F + "test/crmActivityPostgres.test.mjs", [
("""  const accountOnly = { tenantId: T, principalId: "p-reader", capabilities: caps("customer.record.read") };""",
"""  const accountOnly = { tenantId: T, principalId: "p-reader", capabilities: caps("customer.record.read") };
  // crmActivityContributor ALONE: the two activity keys, no customer.record.read (the explicit parity restriction, #243).
  const contributorOnly = { tenantId: T, principalId: "p-reader", capabilities: caps("crm.activity.read", "crm.activity.create") };"""),
("""  await t.test("READ: never wider than the Account read""",
"""  await t.test("CREATE: Account visibility required; every linked record must be in this tenant AND on this Account", async () => {
    await q(`INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('ct-1',$1,'acct-1','Ana','f','f'),
                                                                                                            ('ct-2',$1,'acct-2','Bo','f','f')`, [T]);
    await q(`INSERT INTO eos_crm.contacts (id, tenant_id, account_id, name, created_by, updated_by) VALUES ('ct-x','t-other','acct-x','Cy','f','f')`);
    await q(`INSERT INTO eos_commercial.opportunities (id, tenant_id, opportunity_number, account_id, owner_employee_id, created_by, updated_by)
             VALUES ('opp-1',$1,'OPP-1','acct-1','e-1','f','f'), ('opp-2',$1,'OPP-2','acct-2','e-1','f','f')`, [T]);
    const before = await counts();
    const make = (actor, over) => A.createAccountActivity(deps, actor, { accountId: "acct-1", type: "CALL", body: "x", idempotencyKey: `kl-${randomUUID()}`, ...over });
    assert.deepEqual(await refusal(() => make(contributorOnly, {})), ["CAPABILITY_REQUIRED", "FORBIDDEN"],
      "crmActivityContributor alone (no customer.record.read) cannot write to an Account it cannot read");
    assert.deepEqual(await refusal(() => make(rep, { contactId: "ct-2" })), ["CONTACT_NOT_FOUND", "NOT_FOUND"], "a Contact on ANOTHER Account");
    assert.deepEqual(await refusal(() => make(rep, { contactId: "ct-x" })), ["CONTACT_NOT_FOUND", "NOT_FOUND"], "another tenant's Contact == unknown");
    assert.deepEqual(await refusal(() => make(rep, { contactId: "ct-zz" })), ["CONTACT_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(await refusal(() => make(rep, { opportunityId: "opp-2" })), ["OPPORTUNITY_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(await refusal(() => make(rep, { salesOrderId: "so-zz" })), ["SALES_ORDER_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(await counts(), before, "no refusal wrote anything");
    const ok = await make(rep, { contactId: "ct-1", opportunityId: "opp-1" });
    assert.equal(ok.replayed, false, "references on the same Account are accepted");
  });

  await t.test("READ: never wider than the Account read"""),
("""    await A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "MEETING", body: "Site visit", occurredAtMillis: backdated, idempotencyKey: "k7",
      contactId: "ct-9", opportunityId: "opp-3" });""",
"""    await A.createAccountActivity(deps, rep, { accountId: "acct-1", type: "MEETING", body: "Site visit", occurredAtMillis: backdated, idempotencyKey: "k7",
      contactId: "ct-1", opportunityId: "opp-1" });"""),
("""    assert.deepEqual(await refusal(() => A.listAccountActivities(deps, accountOnly, { accountId: "acct-1" })), ["CAPABILITY_REQUIRED", "FORBIDDEN"]);""",
"""    assert.deepEqual(await refusal(() => A.listAccountActivities(deps, accountOnly, { accountId: "acct-1" })), ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
    assert.deepEqual(await refusal(() => A.listAccountActivities(deps, contributorOnly, { accountId: "acct-1" })), ["CAPABILITY_REQUIRED", "FORBIDDEN"],
      "the explicit parity restriction: crmActivityContributor alone does not read an Account's activity");"""),
("""    assert.deepEqual(list.activities.map((a) => a.type), ["CALL", "MEETING"], "most recent INTERACTION first, not recording order");
    const meeting = list.activities[1];""",
"""    assert.deepEqual(list.activities.map((a) => a.type).filter((t) => t === "MEETING").length, 1);
    assert.equal(list.activities[list.activities.length - 1].type, "MEETING", "most recent INTERACTION first, not recording order");
    const meeting = list.activities[list.activities.length - 1];"""),
("""    assert.deepEqual([meeting.contactId, meeting.opportunityId, meeting.salesOrderId, meeting.createdByUid], ["ct-9", "opp-3", null, "p-rep"]);""",
"""    assert.deepEqual([meeting.contactId, meeting.opportunityId, meeting.salesOrderId, meeting.createdByUid], ["ct-1", "opp-1", null, "p-rep"]);"""),
])
