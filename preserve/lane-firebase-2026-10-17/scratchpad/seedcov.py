from ed import edit
p = "D:/eos-fb-exit/functions/test/adminPolicySeedCoverage.test.mjs"
edit(p, [
("""named by the four finance.policy.* capabilities (migration 1764560000000).
  assert.equal(ledger.seeded.objects, 49);""",
"""named by the four finance.policy.* capabilities (migration 1764560000000).
  // 49 -> 50, objectsFromCapabilityAuthority 15 -> 16: Returns intake (#242, F7a) -- `inventoryReturn`, named by inventory.returns.intake (migration 1764580000000); a BUSINESS_ACTION-only security subject with no EntityDefinition, the same shape as settlement and rentalEquipment.
  assert.equal(ledger.seeded.objects, 50);"""),
("""  assert.equal(ledger.seeded.objectsFromCapabilityAuthority, 15);""", """  assert.equal(ledger.seeded.objectsFromCapabilityAuthority, 16);"""),
])
