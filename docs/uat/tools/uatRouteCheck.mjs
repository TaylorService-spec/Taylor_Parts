#!/usr/bin/env node
// UAT ROUTE CHECK (Phase 2, item A). Offline; no network, no database. Exit 0 = every API path in the UAT plan is a route the server dispatches.
//
// The phase 1 census used the bare prefixes /workforce, /crm and /commercial. The server (functions/src/eosApi/server.ts eosApiDomainFor) routes a path
// by prefix ("/crm/", "/commercial/", "/workforce/") and each transport then accepts ONLY its exact route constant (/crm/customer, /commercial/sales,
// /workforce/employees). A bare prefix falls to the Administration default and answers UNKNOWN_OPERATION, so every such case would have failed for the
// wrong reason. This check reads the route constants from the server source and refuses any path the plan uses that is not one of them.
//
// Usage: node docs/uat/tools/uatRouteCheck.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { servedRoutes, eosApiDomainForPort, extractOperations } from "./uatExtract.mjs";
import { PROBES } from "./uatProbes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const served = servedRoutes();
const spec = JSON.parse(fs.readFileSync(path.join(HERE, "ventana-uat-fixture.spec.json"), "utf8"));
const uses = new Map();
const use = (r, who) => { if (!uses.has(r)) uses.set(r, new Set()); uses.get(r).add(who); };
for (const o of extractOperations().operations) use(o.route, "operation registry");
for (const p of PROBES) use(p.route, "probe table");
for (const s of spec.steps) use(s.route, "Ventana fixture spec");

let bad = 0;
for (const [r, who] of uses) {
  const ok = served.has(r) && (r === "/admin/policy" || eosApiDomainForPort(r) !== "administration");
  if (!ok) { bad += 1; console.error(`NOT A SERVED ROUTE: ${r}  (used by ${[...who].join(", ")})`); }
}
// Negative control: the three phase 1 mistakes must be refused by this very check.
for (const wrong of ["/workforce", "/crm", "/commercial"]) {
  if (served.has(wrong) || eosApiDomainForPort(wrong) !== "administration") { bad += 1; console.error(`NEGATIVE CONTROL FAILED: ${wrong} would be accepted`); }
}
// And the real ones must be accepted and routed to their own transport.
for (const [route, domain] of [["/workforce/employees", "workforce"], ["/crm/customer", "crm"], ["/commercial/sales", "commercial"]]) {
  if (!served.has(route) || eosApiDomainForPort(route) !== domain) { bad += 1; console.error(`EXPECTED ROUTE MISSING: ${route} -> ${domain}`); }
}
console.log(bad === 0 ? `ROUTE CHECK OK: ${uses.size} routes used by the plan, all dispatched by the server (${served.size} known); phase 1 bare paths refused.` : `ROUTE CHECK FAILED: ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 2);
