from ed import edit
p = "test/navCutoverEnvironmentScoped.test.mjs"
edit(p, [
("""// Owner confirmation). Again the total did not move and production's legacy destination set is unchanged.
test("RATCHET: the register partitions into 23 + 39 = 62, derived from NAV_SURFACE_ACCESS", () => {
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 62);
  assert.equal(NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.length, 23);
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS.length, 39);
  assert.equal(NAV_GOVERNED_PLACEHOLDER_DESTINATIONS.length, 0);
  assert.equal(NAV_LEGACY_PLACEHOLDER_CEILING, 62);
  assert.equal(NAV_CUTOVER_PLACEHOLDER_CEILING, 23);
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_CEILING, 39);""",
"""// Owner confirmation). Again the total did not move and production's legacy destination set is unchanged.
// 2026-10-17: 23 + 39 became 24 + 38 when the EXISTING `inventory/manufacturers` row earned inventory.catalog (Manufacturers
// R-1 Option A, Owner-approved; Firebase exit F5).
test("RATCHET: the register partitions into 24 + 38 = 62, derived from NAV_SURFACE_ACCESS", () => {
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 62);
  assert.equal(NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.length, 24);
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS.length, 38);
  assert.equal(NAV_GOVERNED_PLACEHOLDER_DESTINATIONS.length, 0);
  assert.equal(NAV_LEGACY_PLACEHOLDER_CEILING, 62);
  assert.equal(NAV_CUTOVER_PLACEHOLDER_CEILING, 24);
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_CEILING, 38);"""),
("""  assert.ok(ungovernedGrowth.some((p) => p.includes("NO governed surface, above the shrink-only ceiling of 39")));""",
"""  assert.ok(ungovernedGrowth.some((p) => p.includes("NO governed surface, above the shrink-only ceiling of 38")));"""),
("""  assert.ok(governedGrowth.some((p) => p.includes("ALREADY holds a governed surface, above the shrink-only ceiling of 23")));""",
"""  assert.ok(governedGrowth.some((p) => p.includes("ALREADY holds a governed surface, above the shrink-only ceiling of 24")));"""),
("""  const crossed = NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.filter((d) => !CUTOVER_BEFORE_SUPPLIER_TRANSITION.includes(d) && d !== "financials/overview");""",
"""  const crossed = NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.filter((d) => !CUTOVER_BEFORE_SUPPLIER_TRANSITION.includes(d)
    && d !== "financials/overview" && d !== "inventory/manufacturers");"""),
])
s = open(p, encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip("\r\n") + (nl + nl + """// MANUFACTURERS R-1 OPTION A (2026-10-17, Firebase exit F5): `inventory/manufacturers` moved UNGOVERNED -> CUTOVER because the
// destination now earns the existing `inventory.catalog` surface -- the surface its list read's capability already earns.
test("TRANSITION: inventory/manufacturers changed kind (R-1 Option A), and nothing was added", () => {
  assert.equal(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.length, 62);
  assert.ok(NAV_LEGACY_PLACEHOLDER_DESTINATIONS.includes("inventory/manufacturers"), "the legacy row stays for flag-false environments");
  assert.ok(NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.includes("inventory/manufacturers"));
  assert.equal(NAV_UNGOVERNED_PLACEHOLDER_DESTINATIONS.includes("inventory/manufacturers"), false);
  assert.deepEqual(NAV_SURFACE_ACCESS["inventory/manufacturers"], ["inventory.catalog"]);
  const item = itemAt("inventory/manufacturers");
  assert.equal(isNavItemVisible(item, null, [], eosContext(eosAuthority([]))), false, "visible without the surface");
  assert.equal(isNavItemVisible(item, null, [], eosContext(eosAuthority(["inventory.catalog"]))), true, "the surface opens it");
  assert.equal(isNavItemVisible(item, null, [], eosContext(eosAuthority(["inventory.catalogAdmin"]))), false, "Catalog Admin alone does not");
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN, "owner"]) {
    assert.equal(isNavItemVisible(item, role, keysFor(role), eosContext(eosAuthority([]))), false, `role literal ${role} opened it under the EOS source`);
  }
});
""").replace("\n", nl)
open(p, "w", encoding="utf-8", newline="").write(s)

p = "test/partMasterManufacturersNavHidden.test.mjs"
edit(p, [
("""// MANUFACTURERS' REASON STILL HOLDS: the `manufacturers` collection read is Rules-closed to every
// persona, so nobody can use the screen regardless of where it sits in the rail.""",
"""// MANUFACTURERS STAYS OFF THE RAIL, for a different reason now: since Firebase exit F5 its list reads EOS
// (eos_ops.manufacturers), and R-1 Option A gave it the `inventory.catalog` surface, but it is reached from
// Catalog rather than added to the rail."""),
("""test("Manufacturers stays navHidden while its read is Rules-closed", () => {""",
"""test("Manufacturers stays navHidden (reached from Catalog, not the rail)", () => {"""),
("""// the governed surface `inventory.catalogAdmin` and `inventory/manufacturers` has none (its read is
// Rules-closed for every persona; NAV_SURFACE_GAPS says so) -- but the conclusion it drew, that the""",
"""// the governed surface `inventory.catalogAdmin` and `inventory/manufacturers` had none at the time (R-1
// Option A has since mapped it to `inventory.catalog`) -- but the conclusion it drew, that the"""),
("""  // The cutover asymmetry, recorded where it is relevant: one of these two has somewhere to go when
  // its environment flips the flag, and the other does not.
  assert.deepEqual(partMaster.surfaceAccess, ["inventory.catalogAdmin"]);
  assert.equal(partMaster.legacyPlaceholder, true);
  assert.equal(manufacturers.surfaceAccess, undefined,
    "Manufacturers earned a surface -- then it joins the cutover partition and its ceiling");
  assert.equal(manufacturers.legacyPlaceholder, true);""",
"""  // Both now have somewhere to go when their environment flips the flag: Part Master to Catalog Admin, and
  // Manufacturers (R-1 Option A) to the `inventory.catalog` surface its read's capability earns.
  assert.deepEqual(partMaster.surfaceAccess, ["inventory.catalogAdmin"]);
  assert.equal(partMaster.legacyPlaceholder, true);
  assert.deepEqual(manufacturers.surfaceAccess, ["inventory.catalog"]);
  assert.equal(manufacturers.legacyPlaceholder, true);"""),
])
