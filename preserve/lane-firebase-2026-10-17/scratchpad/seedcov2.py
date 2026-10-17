from ed import edit
p = "D:/eos-fb-exit/functions/test/adminPolicySeedCoverage.test.mjs"
edit(p, [
("""named by the four finance.policy.* capabilities (migration 1764560000000).
  assert.equal(ledger.seeded.objects, 49);""",
"""named by the four finance.policy.* capabilities (migration 1764560000000).
  // 49 -> 50, objectsFromCapabilityAuthority 15 -> 16: CRM activity (#243, F7b) -- `crmActivity`, named by crm.activity.read / crm.activity.create (migration 1764590000000); a security subject with no EntityDefinition and no CRED verb (reading it also needs customer.record.read, so a derived R cell would overstate it).
  assert.equal(ledger.seeded.objects, 50);"""),
("""  assert.equal(ledger.seeded.objectsFromCapabilityAuthority, 15);""", """  assert.equal(ledger.seeded.objectsFromCapabilityAuthority, 16);"""),
])
