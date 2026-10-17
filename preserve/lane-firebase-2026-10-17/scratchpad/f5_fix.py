from ed import edit
edit("test/navCutoverEnvironmentScoped.test.mjs", [
("""  // and 2026-10-14 Financials Overview transitions below are pinned on their own.)
  const crossed = NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.filter((d) => !CUTOVER_BEFORE_SUPPLIER_TRANSITION.includes(d)
    && d !== "administration/financialPolicy" && d !== "financials/overview");""",
"""  // 2026-10-14 Financials Overview and 2026-10-17 Manufacturers transitions below are pinned on their own.)
  const crossed = NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.filter((d) => !CUTOVER_BEFORE_SUPPLIER_TRANSITION.includes(d)
    && d !== "administration/financialPolicy" && d !== "financials/overview" && d !== "inventory/manufacturers");"""),
("""  const crossed = NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.filter((d) => !CUTOVER_BEFORE_SUPPLIER_TRANSITION.includes(d));
  assert.deepEqual(crossed.sort(), ["administration/financialPolicy", "financials/overview", "purchasing/suppliers"], "exactly three rows ever crossed");""",
"""  const crossed = NAV_CUTOVER_PLACEHOLDER_DESTINATIONS.filter((d) => !CUTOVER_BEFORE_SUPPLIER_TRANSITION.includes(d));
  assert.deepEqual(crossed.sort(), ["administration/financialPolicy", "financials/overview", "inventory/manufacturers", "purchasing/suppliers"],
    "exactly four rows ever crossed (Manufacturers on 2026-10-17, pinned below)");"""),
])
edit("test/manufacturersMetadataList.test.jsx", [
("""import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";""",
"""import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";"""),
("""    fireEvent.click(screen.getAllByRole("button", { name: /^Rename/ })[0]);""",
"""    const rowOf = (name) => screen.getAllByRole("row").find((r) => r.textContent.includes(name));
    fireEvent.click(within(rowOf("Alpha Mfg")).getByRole("button", { name: /Rename/ }));"""),
("""    fireEvent.click(screen.getAllByRole("button", { name: /^Status/ })[1]);""",
"""    fireEvent.click(within(rowOf("Beta Industrial")).getByRole("button", { name: /Status/ }));"""),
])
