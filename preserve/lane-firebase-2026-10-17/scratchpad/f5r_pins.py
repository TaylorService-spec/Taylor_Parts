from ed import edit
edit("field-ops-app-vite/test/salesAgreementsAndNavCutover.test.mjs", [
("""  "financials/overview",
]);""",
"""  "financials/overview",
  // 2026-10-17 (Manufacturers R-1 Option A, Firebase exit F5): an EXISTING row that changed kind -- it earned inventory.catalog.
  "inventory/manufacturers",
]);"""),
("""test("the placeholder register is 62, split into 23 cutover rows and 39 ungoverned ones", () => {""",
"""test("the placeholder register is 62, split into 24 cutover rows and 38 ungoverned ones", () => {"""),
])

edit("field-ops-app-vite/test/listsP2Tranche1.test.jsx", [
("""describe("Manufacturers reads the whole collection, so it claims no boundary", () => {
  // OWNER RULING, tranche 1: "Render no pagination control/footer unless the governed read supports
  // it." getManufacturerCatalog takes no limit and no cursor and returns no `truncated` flag — there
  // is no page boundary to report, so any control implying one would be invented by the interface.""",
"""describe("Manufacturers reads one bounded list with no cursor, so it claims no page boundary", () => {
  // OWNER RULING, tranche 1: "Render no pagination control/footer unless the governed read supports
  // it." Firebase exit F5: listManufacturers (EOS Catalog API) is one call bounded at 1,000 rows with a
  // `truncated` flag and NO cursor -- there is no page to load, so any pager would be invented. A
  // truncated list is disclosed in the header instead, and prints no count."""),
("""  it("the header count is exact BECAUSE the read is complete, and null when it is not", () => {
    // The one place an unbounded read is a licence rather than a liability: a count over every row
    // IS the collection count. It is still null on any unsettled read — "0 manufacturers" over a
    // denial states that the business has none when the truth is that this reader may not see them.
    expect(MANUFACTURERS).toMatch(/state\\.phase === "ready" \\? \\(state\\.manufacturers\\?\\.length \\?\\? null\\) : null/);
  });""",
"""  it("the header count is exact only when the list is complete: null when truncated or unsettled", () => {
    // An untruncated list IS the collection count. A truncated one is not, and "0 manufacturers" over a
    // denial states that the business has none when the truth is that this reader may not see them.
    expect(MANUFACTURERS).toMatch(/state\\.phase === "ready" && !state\\.truncated \\? \\(state\\.manufacturers\\?\\.length \\?\\? null\\) : null/);
  });"""),
("""    // No row actions either: the Firebase write affordances were removed (Firebase exit PR-B) and the page is read-only.
    expect(code(MANUFACTURERS)).not.toMatch(/rowActions/);""",
"""    // The rows carry governed row ACTIONS instead (Rename, Status -- restored on EOS by Firebase exit F5), never a link.
    expect(code(MANUFACTURERS)).toMatch(/rowActions=\\{rowActions\\}/);"""),
])
