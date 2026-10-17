from ed import edit
F = "D:/eos-fb-exit/functions/"
edit(F + "test/crmAuthority.test.mjs", [
("""  // DQ-022: ownership.handoff.correct (migration 1763683200000) gates the ADMINISTRATIVE handoff sources on an Account.
  assert.deepEqual([...used].sort(), [...CRM_CAPABILITY_IDS, "ownership.handoff.correct"].sort());""",
"""  // DQ-022: ownership.handoff.correct (migration 1763683200000) gates the ADMINISTRATIVE handoff sources on an Account.
  // Firebase exit F7b (DECISIONS #243): crm.activity.read / .create (migration 1764590000000) gate the Account's activity
  // timeline -- catalog ids the Firestore callables already checked, now on the CRM route.
  assert.deepEqual([...used].sort(), [...CRM_CAPABILITY_IDS, "ownership.handoff.correct", "crm.activity.create", "crm.activity.read"].sort());"""),
])
edit(F + "test/ownerCapabilityContract.test.mjs", [
("""  "audit.event.read",
  "customer.record.create",""", """  "audit.event.read",
  // F7b (#243, migration 1764590000000): registered in PostgreSQL and mirrored to owner -- the contract's existing
  // OWNER_COMMERCIAL_AUTHORITY declaration, now in vocabulary. 41 -> 43.
  "crm.activity.create",
  "crm.activity.read",
  "customer.record.create","""),
("""check("Owner's governed (in-vocabulary) capabilities are exactly the 41 in the contract", () => {
  assert.deepEqual(ownerInVocabulary, [...OWNER_CONTRACT_IN_VOCABULARY].sort());
  assert.equal(ownerInVocabulary.length, 41, "41 governed capabilities -- 47 live minus the 6 with no PERMISSION_CATALOG id");""",
"""check("Owner's governed (in-vocabulary) capabilities are exactly the 43 in the contract", () => {
  assert.deepEqual(ownerInVocabulary, [...OWNER_CONTRACT_IN_VOCABULARY].sort());
  assert.equal(ownerInVocabulary.length, 43, "43 governed capabilities -- the 41 of the contract + crm.activity.read / .create, registered by F7b");"""),
])
p = F + "test/governedNonprodReplayPostgres.test.mjs"
s = open(p, encoding="utf-8", newline="").read()
for old, new in [('assert.equal(await count(), 495, "baseline + D-A + Service activation");', 'assert.equal(await count(), 501, "baseline + D-A + Service activation (+6: the CRM-activity parity grants, migration 1764590000000)");'),
  ('), 499, "D-B', '), 505, "D-B'), ('), 500, "Sales', '), 506, "Sales'), ('), 501, "Service', '), 507, "Service'), ('), 513, "recorded', '), 519, "recorded'),
  ('), 513, "DQ-033', '), 519, "DQ-033'), ('), 519, "Parts', '), 525, "Parts'), ('), 519, "Purchasing', '), 525, "Purchasing'), ('), 526, "Inventory', '), 532, "Inventory'),
  ('), 535, "Equipment', '), 541, "Equipment'), ('), 542, "Truck', '), 548, "Truck'), ('truckInventoryActivationOperations()), 542);', 'truckInventoryActivationOperations()), 548);'),
  ('FROM eos_policy.capabilities`)).rows[0].n, 139); //', 'FROM eos_policy.capabilities`)).rows[0].n, 141); // 139 -> 141: crm.activity.read / .create (#243, 1764590000000). //')]:
    assert s.count(old) == 1, (old, s.count(old)); s = s.replace(old, new)
open(p, "w", encoding="utf-8", newline="").write(s)
