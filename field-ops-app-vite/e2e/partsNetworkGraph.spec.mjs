// PARTS FULL-BROWSER NETWORK GRAPH -- TEST INFRASTRUCTURE (not an application change; not a required CI check).
//
// WHY THIS EXISTS. The unit and component suites (vitest + jsdom) render a page with its hooks, its service clients, its
// session and its shell mocked or stubbed. They prove what a component does with an answer it is handed; they cannot see
// what the real shell asks the real API, with a real governed session, when a real person opens the page. Five consecutive
// UAT rounds were "fixed" by green unit tests while the browser still fired requests the server refuses. This test closes
// that gap: it signs in through the real UI (password + TOTP), walks the Parts pages, and judges the actual network.
//
// WHAT IT DOES, PER PERSONA (Warehouse Associate, Parts Associate, Parts Manager, Warehouse Manager):
//   1. signs in through the real login form (password, then the authenticator code);
//   2. visits Parts Catalog (/inventory), Part detail (/inventory/<part>), Part detail with ?requestId=, and Receiving,
//      mixing direct loads with in-app navigation (link clicks / history pushes) between them;
//   3. after each page waits for network idle PLUS a settle window (>= 5 s) so background activity is caught;
//   4. RECORDS EVERY request to the API origin: method, path, JSON `operation`, status, and the step that fired it;
//   5. FAILS on ANY 4xx (or 5xx / transport failure) other than the pre-login 401 on POST /auth/refresh -- not restricted to
//      known operation names;
//   6. asserts positive visibility: holders see what their grants allow (reads they hold return 200; the Parts Manager's
//      reorder card and supplier terms are on screen);
//   7. writes network-inventory.json and network-matrix.md (persona x page x operation x status).
//
// TARGET-CONFIGURABLE. The same spec runs against the local governed stack (e2e/localStack/) or, with its own governed
// credentials, a remote non-production target. See e2e/README.md. Environment:
//   EOS_NET_APP_URL            app origin            (default http://127.0.0.1:5191)
//   EOS_NET_API_ORIGIN         EOS API origin        (default http://127.0.0.1:8791; REQUIRED for a non-loopback app)
//   EOS_NET_CREDENTIALS_FILE   JSON of persona credentials (shape of scripts/enrollPersonaLogins.js output)
//   EOS_NET_PERSONAS           comma list of persona keys (default all four)
//   EOS_NET_PART_ID            part to open         (default PRT-1001)
//   EOS_NET_REQUEST_ID         ?requestId= value    (default: world file's seeded request, else RR-SYNTHETIC-0001)
//   EOS_NET_WORLD_FILE         seed manifest written by the local stack (optional)
//   EOS_NET_SETTLE_MS          settle window per page (default 6000; floor 5000)
//   EOS_NET_EXPECTED_CAPS_FILE JSON with caps[{employee_id,caps[]}] to compare resolveMyCapabilities against (optional)
//   EOS_NET_OUT_DIR            where the inventory/matrix are written (default e2e-output/)
//   EOS_NET_ALLOW_REMOTE=1     required for any non-loopback target; a production host is refused regardless.
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAS, loadCredentials, totpNow } from "./support/personas.mjs";
import { attachRecorder, isExpectedRefusal } from "./support/networkRecorder.mjs";
import { PAGE_OF_STEP, summarize, writeReports } from "./support/inventoryReport.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = (process.env.EOS_NET_APP_URL ?? "http://127.0.0.1:5191").replace(/\/+$/, "");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const appHost = new URL(APP_URL);
if (!LOOPBACK.has(appHost.hostname)) {
  if (process.env.EOS_NET_ALLOW_REMOTE !== "1") throw new Error("REFUSED: a non-loopback EOS_NET_APP_URL needs EOS_NET_ALLOW_REMOTE=1");
  if (!process.env.EOS_NET_API_ORIGIN) throw new Error("REFUSED: a remote target must name EOS_NET_API_ORIGIN explicitly");
}
if (/taylor-parts\.(web\.app|firebaseapp\.com)|production/i.test(`${APP_URL} ${process.env.EOS_NET_API_ORIGIN ?? ""}`)) {
  throw new Error("REFUSED: this test never runs against production.");
}
const API_ORIGIN = (process.env.EOS_NET_API_ORIGIN ?? "http://127.0.0.1:8791").replace(/\/+$/, "");
const SETTLE_MS = Math.max(5000, Number(process.env.EOS_NET_SETTLE_MS ?? 6000));
const PART_ID = process.env.EOS_NET_PART_ID ?? "PRT-1001";
const OUT_DIR = resolve(process.env.EOS_NET_OUT_DIR ?? join(HERE, "..", "e2e-output"));
const readJson = (f) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const WORLD = readJson(process.env.EOS_NET_WORLD_FILE);
const REQUEST_ID = process.env.EOS_NET_REQUEST_ID ?? WORLD?.requestId ?? "RR-SYNTHETIC-0001";
const EXPECTED_CAPS = readJson(process.env.EOS_NET_EXPECTED_CAPS_FILE);
const only = (process.env.EOS_NET_PERSONAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SELECTED = PERSONAS.filter((p) => only.length === 0 || only.includes(p.key));

const inventory = {
  schema: "eos.parts-browser-network-inventory/1",
  generatedAt: new Date().toISOString(),
  target: { appUrl: APP_URL, apiOrigin: API_ORIGIN, partId: PART_ID, requestId: REQUEST_ID },
  settleMs: SETTLE_MS,
  personas: {},
};

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Sign in through the real form: identifier + password, then the authenticator code. */
async function signIn(page, creds) {
  await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Sign-in name").fill(creds.loginIdentifier);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  const code = page.getByLabel("Verification code");
  await code.waitFor({ state: "visible", timeout: 30_000 });
  // Never submit a code that is about to roll over: wait for the next 30 s step if fewer than 4 s remain in this one.
  const remainingMs = 30_000 - (Date.now() % 30_000);
  if (remainingMs < 4000) await page.waitForTimeout(remainingMs + 500);
  await code.fill(totpNow(creds.totpSecretBase32));
  await page.getByRole("button", { name: /^Verify/ }).click();
  await page.getByLabel("Verification code").waitFor({ state: "detached", timeout: 30_000 });
}

/** In-app navigation: click the real link when the page offers one for this target, else push the route into the router. */
async function appNavigate(page, target) {
  const link = page.locator(`a[href="${target}"]`).first();
  if (await link.count() > 0 && await link.isVisible().catch(() => false)) {
    await link.click();
    return "link-click";
  }
  await page.evaluate((t) => { window.history.pushState({}, "", t); window.dispatchEvent(new PopStateEvent("popstate")); }, target);
  return "history-push";
}

/** What a person with Reorder access sees for the seeded part (local stack seed; override with EOS_NET_REORDER_CARD for another target). */
const REORDER_CARD = new RegExp(process.env.EOS_NET_REORDER_CARD ?? "LOCAL-PO-000950|RR-2026-000950");
const holds = (caps, ...keys) => Array.isArray(caps) && keys.every((k) => caps.includes(k));
const diff = (actual, expected) => ({
  equal: actual.length === expected.length && actual.every((c, i) => c === expected[i]),
  missing: expected.filter((c) => !actual.includes(c)),
  extra: actual.filter((c) => !expected.includes(c)),
});

// Each persona is its own test (default mode: a failing persona never stops the next one running; the inventory is the point).
// A failed test restarts the Playwright worker, so nothing is kept in module state: every persona's record is written to
// <OUT_DIR>/personas/<key>.json the moment it is complete, and the report is merged from those files.
const PERSONA_DIR = join(OUT_DIR, "personas");

for (const persona of SELECTED) {
  test(`${persona.label}: Parts network graph`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const creds = loadCredentials(process.env.EOS_NET_CREDENTIALS_FILE, persona);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const state = { step: "login", phase: "pre-login", capabilities: null, heldRoleKeys: null };
    const rec = attachRecorder(page, { apiOrigin: API_ORIGIN, appOrigin: new URL(APP_URL).origin, state });
    const steps = [];
    const visibility = [];
    const texts = {};
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));

    async function visit(step, how, action) {
      state.step = step;
      const method = await action();
      await settle(page);
      const landed = new URL(page.url());
      steps.push({ step, page: PAGE_OF_STEP[step], navigation: how ?? method, landedPath: `${landed.pathname}${landed.search}` });
      texts[step] = (await page.locator("body").innerText().catch(() => "")).slice(0, 20_000);
    }

    let crash = null;
    try {
      // 1. sign in (the pre-login /auth/refresh 401 happens here and only here).
      await signIn(page, creds);
      state.phase = "post-login";
      await settle(page);
      steps.push({ step: "login", page: "login", navigation: "form", landedPath: new URL(page.url()).pathname });

      // 2. the Parts pages: direct loads, then in-app transitions between them, then direct loads again.
      await visit("catalog", "direct", async () => { await page.goto(`${APP_URL}/inventory`, { waitUntil: "domcontentloaded" }); });
      await visit("part-detail", null, () => appNavigate(page, `/inventory/${PART_ID}`));
      await visit("part-detail-request", null, () => appNavigate(page, `/inventory/${PART_ID}?requestId=${encodeURIComponent(REQUEST_ID)}`));
      await visit("receiving", null, () => appNavigate(page, "/inventory/receiving"));
      await visit("catalog-return", null, () => appNavigate(page, "/inventory"));
      await visit("part-detail-direct", "direct", async () => { await page.goto(`${APP_URL}/inventory/${PART_ID}`, { waitUntil: "domcontentloaded" }); });
      await visit("receiving-direct", "direct", async () => { await page.goto(`${APP_URL}/inventory/receiving`, { waitUntil: "domcontentloaded" }); });
    } catch (err) {
      crash = err;
    }

    await rec.flush();
    const entries = rec.entries;

    // 3. the judgement: ANY 4xx except the expected pre-login 401, any 5xx, any transport failure (an aborted navigation is not one).
    const violations = entries.filter((e) => {
      if (e.failure) return e.failure !== "net::ERR_ABORTED";
      if (e.status === null) return false;
      return e.status >= 400 && !isExpectedRefusal(e, e.phase);
    });

    // 4. positive visibility: what the grants allow must be on the wire (200) and, for the Parts roles, on screen.
    const ok200 = (operation, ...onSteps) => entries.some((e) => e.operation === operation && e.status === 200 && (onSteps.length === 0 || onSteps.includes(e.step)));
    const caps = state.capabilities;
    const check = (label, pass) => visibility.push({ check: label, ok: Boolean(pass) });
    check("resolveMyCapabilities answered 200 and listed capabilities", ok200("resolveMyCapabilities") && Array.isArray(caps) && caps.length > 0);
    if (holds(caps, "inventory.supplierTerms.read")) {
      check("holds inventory.supplierTerms.read: listPartSupplierItems returned 200 on Part detail", ok200("listPartSupplierItems", "part-detail", "part-detail-direct"));
    }
    if (holds(caps, "reorder.request.read") && persona.scopes.some((s) => s.startsWith("REORDER_QUEUE:"))) {
      check("holds reorder.request.read + REORDER_QUEUE scope: readReorderQueue returned 200 on Part detail", ok200("readReorderQueue", "part-detail", "part-detail-direct"));
      check("holds reorder.request.read + REORDER_QUEUE scope: readReorderQueue returned 200 on Receiving", ok200("readReorderQueue", "receiving", "receiving-direct"));
    }
    const detail = texts["part-detail-direct"] ?? "";
    if (persona.key === "partsManager") {
      check("Parts Manager sees the Suppliers & Terms section with the seeded supplier terms (SKU ACME-FAN-1001)", /Suppliers & Terms/i.test(detail) && /ACME-FAN-1001/.test(detail));
      check("Parts Manager sees the Reorder card for the part (request RR-2026-000950 / purchase order LOCAL-PO-000950)", REORDER_CARD.test(detail));
    }
    if (persona.key === "partsAssociate") {
      check("Parts Associate sees the Reorder card for the part (request / purchase order)", REORDER_CARD.test(detail));
    }

    // 5. grant parity against the live read, when one was supplied.
    let parity = null;
    const expected = EXPECTED_CAPS?.caps?.find((c) => c.employee_id === persona.employeeId)?.caps;
    if (expected && caps) parity = diff(caps, [...expected].sort());

    mkdirSync(PERSONA_DIR, { recursive: true });
    writeFileSync(join(PERSONA_DIR, `${persona.key}.json`), JSON.stringify({
      key: persona.key, label: persona.label, employeeId: persona.employeeId, requestCount: entries.length,
      capabilities: caps, heldRoleKeys: state.heldRoleKeys, parity, crash: crash ? String(crash.message ?? crash).slice(0, 500) : null,
      steps, matrix: summarize(entries), violations, visibility, pageErrors, otherOrigins: Object.fromEntries(rec.otherOrigins),
      unanswered: entries.filter((e) => e.status === null && !e.failure).length,
      requests: entries,
    }, null, 2));
    await context.close();

    if (crash) throw crash;
    expect(violations.map((v) => `${v.step}: ${v.method} ${v.operation ?? v.path} -> ${v.status ?? v.failure} ${v.code ?? ""}`), `refused requests for ${persona.label}`).toEqual([]);
    expect(visibility.filter((v) => !v.ok).map((v) => v.check), `positive visibility for ${persona.label}`).toEqual([]);
    if (parity) expect(parity, `grant parity for ${persona.label}`).toMatchObject({ equal: true });
  });
}

test.afterAll(() => {
  const personas = {};
  for (const p of SELECTED) {
    const f = join(PERSONA_DIR, `${p.key}.json`);
    if (existsSync(f)) personas[p.key] = JSON.parse(readFileSync(f, "utf8"));
  }
  writeReports(OUT_DIR, { ...inventory, generatedAt: new Date().toISOString(), personas });
});
