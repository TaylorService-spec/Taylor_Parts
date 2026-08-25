// THE TECHNICIAN'S DOWNLOAD, GUARDED.
//
// ============================ THE MEASUREMENT THAT PROMPTED THIS ============================
//
// The app shipped as ONE JavaScript chunk of 1,965 kB (545 kB gzipped). Every surface -- CRM, sales,
// purchasing, administration, reporting, the whole inventory suite -- was statically imported into
// the entry bundle by App.jsx's 78 imports, so a technician opening their next job on weak cellular
// downloaded the entire desktop application to see one work order.
//
// Nothing was wrong with the code. Vite's rolldown build simply had no code splitting configured,
// and 78 eager imports is what that looks like from the outside.
//
// After making desktop-only route modules lazy: entry 627 kB (181 kB gzip) across 82 chunks.
//
// ============================ WHY A TEST AND NOT A NOTE ============================
//
// A bundle improvement with no guard is a bundle improvement with a half-life. One `import Foo from
// "./modules/administration/..."` added to App.jsx for convenience puts administration back in the
// technician's entry chunk, nothing fails, and the regression is invisible until somebody measures
// again months later.
//
// So this asserts the SHAPE that produces the number -- desktop surfaces are lazy, technician
// surfaces are eager -- rather than the number itself. A byte threshold would either be so loose it
// caught nothing or so tight it failed on an unrelated dependency bump.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

/**
 * Surfaces a technician never reaches, which therefore must not be in their entry chunk.
 *
 * Every one is gated by nav visibility and by Rules already; this is about WEIGHT, not access.
 */
// `./modules/registry/` is deliberately absent: App.jsx does not route it, so listing it here would
// assert the existence of something that was never there.
const DESKTOP_ONLY = [
  "./modules/administration/",
  "./modules/sales/",
  "./modules/purchasing/",
  "./modules/accounts/",
  "./modules/inventory/",
  "./modules/reporting/",
  "./modules/operations/",
  "./modules/scheduling/",
  "./modules/equipment/",
  "./modules/controlTower/",
  "./modules/dispatcherBoard/",
];

/**
 * The technician's OWN screens, which must stay eager.
 *
 * Lazy-loading these would move the cost rather than remove it: a technician who opens the app to
 * find their next job would wait for a second round trip to see it, on exactly the connection this
 * whole change exists to serve.
 */
const TECHNICIAN_EAGER = [
  "./modules/mobile/FieldMode",
  "./modules/technicianDashboard/TechnicianDashboard",
  "./modules/jobs/Jobs",
];

const staticImportOf = (path) => new RegExp(`^import\\s+\\w+\\s+from\\s+"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
const lazyImportOf = (path) => new RegExp(`lazy\\(\\(\\) => import\\("${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

test("NO desktop-only surface is statically imported into the entry bundle", () => {
  // The regression this exists to catch: one convenient static import puts a whole module family
  // back into every technician's download, and nothing else would notice.
  const offenders = [];
  for (const prefix of DESKTOP_ONLY) {
    const re = new RegExp(`^import\\s+\\w+\\s+from\\s+"${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gm");
    for (const m of app.matchAll(re)) offenders.push(m[0].trim());
  }
  assert.deepEqual(offenders, [], "these belong in the technician's entry chunk only by accident");
});

test("desktop surfaces ARE reachable -- lazy, not deleted", () => {
  // The opposite failure: satisfying the check above by removing routes rather than deferring them.
  for (const prefix of DESKTOP_ONLY) {
    assert.match(app, lazyImportOf(prefix), `${prefix} is neither statically imported nor lazy -- is it routed at all?`);
  }
});

test("the technician's OWN screens stay eager", () => {
  for (const path of TECHNICIAN_EAGER) {
    assert.match(app, staticImportOf(path), `${path} must not be lazy -- it is the first thing a technician opens`);
  }
});

test("a Suspense boundary exists, so a deferred route is never a blank frame", () => {
  // A blank frame is indistinguishable from a broken app on a slow connection, which is precisely
  // the connection this change serves.
  assert.match(app, /<Suspense/, "lazy routes without a boundary render nothing while they load");
  // Both must come from react, and the assertion says THAT rather than pinning the exact import
  // line — which broke the moment an unrelated hook joined it. A guard that fails on a change it
  // does not care about teaches people to edit the guard instead of reading it.
  assert.match(app, /import \{[^}]*\blazy\b[^}]*\} from "react"/);
  assert.match(app, /import \{[^}]*\bSuspense\b[^}]*\} from "react"/);
});

test("LAZY CHANGES WHEN CODE LOADS, NEVER WHO MAY LOAD IT", () => {
  // Worth pinning because it is the tempting misreading: a deferred module is not a protected one.
  // Route visibility is still isDomainVisible(); authority is still Rules and the governed resolvers.
  assert.match(app, /isDomainVisible/, "route visibility must still be decided by the governed check");
});
