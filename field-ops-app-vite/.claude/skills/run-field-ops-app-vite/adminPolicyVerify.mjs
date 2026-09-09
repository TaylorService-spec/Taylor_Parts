// BROWSER VERIFICATION for the Administration policy surfaces.
//
// Owner ruling item 12: browser verification is required before the UI tranche may be called
// complete. This drives the real app in a real browser against the emulator and asserts the seven
// named things, screenshotting each.
//
//   Objects expansion        an object row expands to its fields
//   Role Object CRED         the Role x Object grid renders real grants
//   field expansion          fields appear beneath their object
//   inheritance state        a field says it inherits, in words a screen reader gets too
//   field override           the override/blocked states are REPRESENTED (see the note below)
//   Users assignments        the Users surface renders
//   Workflows screen         states, actions and Role bindings
//
// ON "FIELD OVERRIDE": no override exists for any Role today, because field-level policy lives in
// the EOS policy store and that store is not stood up. So this asserts what is HONESTLY assertable
// -- that every field row is drawn as inherited and the page says why -- rather than faking an
// override to make a screenshot look complete. A verification that manufactures its own subject
// proves nothing.
//
// ALTERNATE PORT. 8080 was held by another session, so this runs against 8085 (firebase.json edited
// locally and never committed). Nobody else's emulator is touched.
//
// Usage: node .claude/skills/run-field-ops-app-vite/adminPolicyVerify.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DRIVER_ACCOUNTS } from "./seed.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "screenshots");
const BASE = "http://localhost:5173/Taylor_Parts/field-ops/?emulator=1";

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`PASS -- ${name}`); }
  else { failed += 1; console.log(`FAIL -- ${name}${detail ? `: ${detail}` : ""}`); }
}

async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name), fullPage: true });
  console.log(`       screenshot -> screenshots/${name}`);
}

async function login(page, accountKey) {
  const acct = DRIVER_ACCOUNTS[accountKey];
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.locator('button[type="submit"]').click();
  await page.locator(".fo-appheader, .fo-workspace, .fo-rail").first().waitFor({ timeout: 20000 });
}

/**
 * Navigate by URL rather than by clicking the rail: this verifies the SCREENS, not the nav.
 *
 * NOT `networkidle`. The app holds live Firestore listeners, so the network never goes idle and the
 * wait times out on a page that has in fact rendered. Waiting for the shell is the honest signal.
 */
async function goto(page, path) {
  await page.goto(`http://localhost:5173/Taylor_Parts/field-ops/${path}?emulator=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".fo-workspace, .fo-appheader, .fo-rail").first().waitFor({ timeout: 20000 });
  // The routed screen is lazy-loaded behind Suspense; give it a beat to swap in.
  await page.waitForTimeout(800);
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  try {
    await login(page, "admin");

    // ════════ ROLES & PERMISSIONS: Object CRED, field expansion, inheritance ════════
    await goto(page, "administration/roles-permissions");

    const grid = page.getByRole("table", { name: /object and field permissions/i });
    check("Role Object CRED -- the grid renders", await grid.isVisible());

    const dashes = await grid.getByTitle(/cannot be granted to any role/i).count();
    check("unavailable CRED is a dash, not an empty checkbox", dashes > 0, `${dashes} found`);

    const boxes = await grid.locator('input[type="checkbox"]').count();
    check("Object CRED cells render", boxes > 0, `${boxes} cells`);

    // THIRTY-SEVEN OBJECTS, not the matrix's 24. Thirteen entities carrying 166 fields -- Supplier,
    // Warehouse, Truck, Reorder Request, Sales Agreement and eight more -- used to appear on no
    // Administration screen at all. Asserted by name, so a regression says WHICH went missing.
    const objectRows = await grid.locator("tbody tr:not(.fo-row-nested)").count();
    check("the grid shows every governable object", objectRows === 37, `${objectRows} object rows`);
    // Matched on the row's TEXT, not its accessible name: the name also carries the caret button's
    // label ("Show the 16 fields of Supplier"), so a name matcher anchored at the start never fires.
    const objectLabels = [];
    for (let i = 0; i < objectRows; i += 1) {
      objectLabels.push(
        (await grid.locator("tbody tr:not(.fo-row-nested)").nth(i).locator("td").first().innerText())
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    for (const label of ["Supplier", "Warehouse", "Truck", "Reorder Request", "Sales Agreement"]) {
      check(
        `previously-missing object is present: ${label}`,
        objectLabels.some((t) => new RegExp(`(^|▸ )${label} ·`).test(t)),
      );
    }

    // MATCHES BOTH STATES. The caret's accessible name flips Show <-> Hide on toggle, which is
    // correct behaviour -- and makes a Show-only locator stop matching the moment it is clicked.
    const caret = grid.getByRole("button", { name: /(show|hide) the \d+ fields of Accounts/i }).first();
    check("Objects expansion -- an object with fields offers a caret", await caret.isVisible());
    await shot(page, "admin-roles-collapsed.png");

    await caret.click();
    await page.waitForTimeout(300);
    check("field expansion -- the caret opens", (await caret.getAttribute("aria-expanded")) === "true");

    const inherited = await grid.getByLabel(/Inherited from the object/i).count();
    check("inheritance state -- fields say they inherit", inherited > 0, `${inherited} inherited cells`);

    const nested = await grid.locator("tr.fo-row-nested").count();

    // UNGOVERNED INHERITS DOWNWARD. Found by looking at the screenshot rather than by a unit test:
    // the object row drew Delete as a dash while its field rows drew an empty checkbox, which
    // reintroduces one level down the failure the third state exists to prevent.
    const fieldDashes = await grid.locator("tr.fo-row-nested").getByTitle(/cannot be granted to any role/i).count();
    check("ungoverned verbs read as a dash on the FIELD rows too", fieldDashes > 0, `${fieldDashes} found`);
    check("field rows render beneath their object", nested > 0, `${nested} field rows`);

    // FIELD OVERRIDE: the state is represented in the UI vocabulary even though no Role has one
    // yet. Asserted on the page's own explanation rather than by faking data.
    const overrideCopy = await page.getByText(/A field INHERITS its object/i).isVisible();
    check("field override -- inheritance and override are explained on the page", overrideCopy);
    await shot(page, "admin-roles-expanded.png");

    // ════════ OBJECTS ════════
    await goto(page, "administration/objects");
    const objectsGrid = page.getByRole("table", { name: /object and field permissions/i });
    check("Objects screen -- the same grid, one implementation", await objectsGrid.isVisible());
    const objCaret = objectsGrid.getByRole("button", { name: /(show|hide) the \d+ fields of/i }).first();
    if (await objCaret.count()) {
      await objCaret.click();
      await page.waitForTimeout(300);
      check("Objects expansion -- fields open here too", (await objectsGrid.locator("tr.fo-row-nested").count()) > 0);
    } else {
      check("Objects expansion -- fields open here too", false, "no caret found");
    }
    await shot(page, "admin-objects.png");

    // ════════ USERS ════════
    await goto(page, "administration/users");
    const usersHeading = await page.getByRole("heading", { name: /users/i }).first().isVisible();
    check("Users assignments -- the Users surface renders", usersHeading);
    await shot(page, "admin-users.png");

    // ════════ WORKFLOWS ════════
    await goto(page, "administration/workflows");
    check("Workflows screen -- it renders", await page.getByRole("heading", { name: "Workflows" }).first().isVisible());

    const draftBadges = await page.locator(".fo-wf-status--draft").count();
    check("Workflows -- the draft/published distinction is drawn", draftBadges > 0, `${draftBadges} draft badges`);

    const statesTable = page.getByRole("table", { name: /states/i }).first();
    check("Workflows -- states render", await statesTable.isVisible());

    const actionsTable = page.getByRole("table", { name: /actions/i }).first();
    check("Workflows -- actions and transitions render", await actionsTable.isVisible());

    const actionCaret = actionsTable.getByRole("button", { name: /(show|hide) the \d+ roles bound to/i }).first();
    check("Workflows -- an action offers its Role bindings", await actionCaret.isVisible());
    await actionCaret.click();
    await page.waitForTimeout(250);
    check("Workflows -- Role bindings expand", (await actionsTable.locator("tr.fo-row-nested").count()) > 0);
    await shot(page, "admin-workflows-parts.png");

    // Sales is THREE families, selectable separately.
    const salesButtons = await page.getByRole("button", { name: /^Sales — (Opportunity|Agreement|Order)/ }).count();
    check("Workflows -- Sales is three separate families", salesButtons === 3, `${salesButtons} found`);

    // THREE AREAS, FIVE STATE MACHINES. The grouping must not reduce the machine count -- that
    // would be the invented-single-Sales-machine failure it exists to avoid.
    const areaHeadings = await page.locator(".fo-wf-area h4").count();
    check("Workflows -- three business areas", areaHeadings === 3, `${areaHeadings} areas`);
    check(
      "Workflows -- the header states 3 areas over 5 state machines",
      await page.getByText(/3 areas · 5 state machines/).isVisible(),
    );
    check(
      "Workflows -- Sales is labelled as three LINKED machines",
      await page.getByText(/3 linked state machines/).isVisible(),
    );
    if (salesButtons > 0) {
      await page.getByRole("button", { name: /^Sales — Opportunity/ }).click();
      await page.waitForTimeout(300);
      await shot(page, "admin-workflows-sales.png");
    }

    // ════════ console ════════
    const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
    check("no console errors across the Administration surfaces", realErrors.length === 0,
      realErrors.slice(0, 3).join(" | "));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await browser.close();
  }
};

run().catch((err) => { console.error("DRIVER ERROR", err); process.exitCode = 1; });
