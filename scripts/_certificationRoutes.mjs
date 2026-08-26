#!/usr/bin/env node
// THE CERTIFICATION ROUTE LIST, DERIVED RATHER THAN REMEMBERED.
//
// ============================ WHY THIS FILE EXISTS ============================
//
// `.certification/routes.json` is a REQUIRED INPUT of certify.mjs and reachability.mjs — both read
// it at module scope and neither writes it — and `.gitignore` excludes `.certification/*` while
// whitelisting only `dynamicRoutes.json`. So nothing in the repository produced it, and nothing
// carried it between checkouts.
//
// The consequence was found by running the acceptance gate in a fresh worktree: step 4 died with
//
//     ENOENT: no such file or directory, open '…/.certification/routes.json'
//
// after steps 1–3 had already passed. A gate that cannot run from a clean checkout is a gate that
// only works on the machine where somebody once created a scratch file by hand, and the day that
// machine is replaced the sweep stops running with no one deciding to stop it.
//
// ============================ WHY navConfig IS THE SOURCE ============================
//
// App.jsx generates a route for EVERY nav item — including the ones a role cannot see, which render
// a denial instead of the screen (see reachability.mjs's header for why that is the designed
// outcome). So navConfig is not *a* description of the destinations; it is *the* one the router
// itself is built from. Deriving from it means the sweep cannot drift out of step with the
// application: a destination added to the nav is swept the next time this runs, and a hand-written
// list would simply keep certifying the site as it was when somebody last remembered to edit it.
//
// Usage:
//   node scripts/_certificationRoutes.mjs          # write .certification/routes.json
//   node scripts/_certificationRoutes.mjs --print  # print the list, write nothing
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const APP_ROOT = join(REPO_ROOT, "field-ops-app-vite");
const OUT_DIR = join(APP_ROOT, ".certification");
const OUT_FILE = join(OUT_DIR, "routes.json");

const { NAV_DOMAINS } = await import(pathToFileURL(join(APP_ROOT, "src", "navigation", "navConfig.js")).href);

/**
 * Flatten a domain's subnav into its destinations.
 *
 * A domain carries GROUPS, and a group carries items — except where the group IS the item, which is
 * the shape several domains use for a single destination. Handling only the first shape silently
 * produced 11 routes instead of 60, and an 11-route sweep reports clean over a site it never
 * visited: the failure mode is a passing gate, not an error.
 */
function destinationsOf(domain) {
  const groups = domain.subnav ?? [];
  return groups.flatMap((group) => (Array.isArray(group.items) ? group.items : [group]));
}

const routes = [];
const seen = new Set();
for (const domain of NAV_DOMAINS ?? []) {
  const items = destinationsOf(domain);
  // A domain with no subnav is still a destination in its own right.
  if (items.length === 0) {
    if (!seen.has(`/${domain.path}`)) { seen.add(`/${domain.path}`); routes.push({ route: `/${domain.path}`, label: domain.label }); }
    continue;
  }
  for (const item of items) {
    // An empty item path means the item IS the domain index — the same rule objectRoutes.js applies.
    const route = item.path ? `/${domain.path}/${item.path}` : `/${domain.path}`;
    if (seen.has(route)) continue;
    seen.add(route);
    routes.push({ route, label: `${domain.label} — ${item.label}` });
  }
}

// A COLLAPSED LIST IS A PASSING GATE, so refuse rather than write one. The count is not asserted
// exactly — destinations are added deliberately and often — but an order-of-magnitude drop means the
// nav shape changed under this deriver, and the sweep must stop rather than certify a fraction.
if (routes.length < 30) {
  console.error(`ABORT: derived only ${routes.length} routes from navConfig — expected the full nav estate.`);
  console.error("       The nav shape has changed; fix destinationsOf() rather than sweeping a subset.");
  process.exit(2);
}

if (process.argv.includes("--print")) {
  for (const r of routes) console.log(`${r.route}\t${r.label}`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(routes, null, 1));
console.log(`certification routes: ${routes.length} destinations -> field-ops-app-vite/.certification/routes.json`);
