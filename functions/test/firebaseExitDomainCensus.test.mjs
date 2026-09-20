// The programme census's proof. Every Firebase business dependency must land in exactly one domain,
// so a new one cannot appear in a domain nobody is accounting for.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIREBASE_EXIT_DOMAINS, FIREBASE_EXIT_DOMAIN_ACCOUNTS, MIGRATION_STATES,
  domainFor, censusByDomain, notStartedDomains, cutOverDomains,
} from "../lib/programCensus/firebaseExitDomainCensus.js";

/** The four BUSINESS categories. firebase_auth and firebase_admin_app are allowed after exit. */
const BUSINESS = ["frontend.firestore_client", "frontend.firebase_functions_client",
  "server.firebase_admin_firestore", "server.firebase_functions_server"];

function businessPaths() {
  const baseline = JSON.parse(
    readFileSync(new URL("../../docs/architecture/firebase-exit-baseline.json", import.meta.url), "utf8"));
  const paths = new Set();
  for (const [root, cats] of Object.entries(baseline.baseline)) {
    for (const [cat, list] of Object.entries(cats)) {
      if (BUSINESS.includes(`${root}.${cat}`)) for (const p of list) paths.add(p);
    }
  }
  return [...paths].sort();
}

const paths = businessPaths();

test("the baseline actually parsed -- this suite is worthless if it reads nothing", () => {
  assert.ok(paths.length > 200, `expected the full business surface, found ${paths.length}`);
});

test("EVERY Firebase business dependency maps to exactly one domain", () => {
  const unmapped = paths.filter((p) => domainFor(p) === null);
  assert.deepEqual(unmapped, [],
    `these files depend on Firebase for business data and belong to no domain, so nobody is `
    + `accounting for them: ${unmapped.slice(0, 12).join(", ")}`);
});

test("longest prefix wins, so a domain cannot swallow its more specific neighbour", () => {
  // The exact collisions this repository has. If the rule regressed to first-match, receiving and
  // transfer would be counted as Inventory and the Purchasing domain would look far smaller.
  assert.equal(domainFor("functions/src/inventoryReceiving/x.ts"), "PURCHASING_RECEIVING_TRANSFER_CYCLE_COUNT");
  assert.equal(domainFor("functions/src/inventoryTransfer/x.ts"), "PURCHASING_RECEIVING_TRANSFER_CYCLE_COUNT");
  assert.equal(domainFor("functions/src/inventoryLedger/x.ts"), "INVENTORY");
  assert.equal(domainFor("functions/src/inventoryLocation/x.ts"), "INVENTORY");
  assert.equal(domainFor("functions/src/workOrderLabor/x.ts"), "WORK_ORDERS_SERVICE");
});

test("every domain is accounted for exactly once, with a stated blocker", () => {
  const listed = FIREBASE_EXIT_DOMAIN_ACCOUNTS.map((a) => a.domain);
  assert.deepEqual([...listed].sort(), [...FIREBASE_EXIT_DOMAINS].sort());
  assert.equal(new Set(listed).size, listed.length, "a domain is accounted for twice");
  for (const a of FIREBASE_EXIT_DOMAIN_ACCOUNTS) {
    assert.ok(a.retirementBlocker.trim().length > 0, `${a.domain} states no retirement blocker`);
    assert.ok(a.currentFirebaseAuthority.trim().length > 0, `${a.domain} does not say what Firebase still owns`);
    assert.ok(a.pathPrefixes.length > 0, `${a.domain} matches nothing`);
    for (const state of [a.postgresState, a.renderState, a.migrationToolingState, a.runtimeCutoverState]) {
      assert.ok(state === null || MIGRATION_STATES.includes(state), `${a.domain}: ${state}`);
    }
  }
});

test("NO STATE IS INFLATED: a later state implies every earlier one", () => {
  // Claiming a runtime cutover without migration tooling, or tooling without a schema, would be a
  // progress report that cannot be true. This is the assertion that keeps the accounting honest.
  const rank = (s) => (s === null ? -1 : MIGRATION_STATES.indexOf(s));
  for (const a of FIREBASE_EXIT_DOMAIN_ACCOUNTS) {
    if (rank(a.runtimeCutoverState) >= MIGRATION_STATES.indexOf("CUT_OVER_ACTIVE")) {
      assert.ok(rank(a.postgresState) >= 0,
        `${a.domain} claims a runtime cutover with no PostgreSQL authority`);
      assert.ok(rank(a.renderState) >= 0,
        `${a.domain} claims a runtime cutover with no Render transport`);
    }
    if (rank(a.migrationToolingState) >= 0) {
      assert.ok(rank(a.postgresState) >= 0,
        `${a.domain} claims migration tooling with nothing to migrate into`);
    }
  }
});

test("the honest front of the programme is named, not averaged away", () => {
  // A domain at null has not reached even BUILT. Reporting a percentage instead of these names is
  // how a programme loses track of what has not been started at all.
  const notStarted = notStartedDomains();
  assert.deepEqual([...notStarted], ["AI_READINESS", "INBOUND_WORK_EMAIL", "PLATFORM_SHARED"]);
  // And only the domains that genuinely run on PostgreSQL are counted as cut over.
  assert.deepEqual([...cutOverDomains()], ["ADMINISTRATION", "EMPLOYEE_WORKFORCE"].filter((x) =>
    FIREBASE_EXIT_DOMAIN_ACCOUNTS.find((a) => a.domain === x).runtimeCutoverState === "CUT_OVER_ACTIVE"));
});

test("Firebase Auth is not counted as a blocker, because it is the intended end state", () => {
  const auth = FIREBASE_EXIT_DOMAIN_ACCOUNTS.find((a) => a.domain === "AUTHENTICATION_SESSION");
  assert.match(auth.retirementBlocker, /NONE, AND BY DESIGN/);
  assert.ok(!cutOverDomains().includes("AUTHENTICATION_SESSION"),
    "counting sign-in identity as remaining work would make the target unreachable by definition");
  // AND THE DOMAIN CONTAINS ONLY GENUINE SIGN-IN FILES. The first version of this assertion asked
  // whether any path looked like auth, and field-ops-app-vite/src/auth/employeeSession.js matched --
  // a file that reads users/{uid} and employees/{id} from Firestore, which is Employee BUSINESS
  // data. Filing it here by its folder would have put a real blocker in the one domain declared not
  // to be one. It is mapped to EMPLOYEE_WORKFORCE, and this checks that it stayed there.
  assert.equal(domainFor("field-ops-app-vite/src/auth/employeeSession.js"), "EMPLOYEE_WORKFORCE");
  const authFiles = paths.filter((p) => domainFor(p) === "AUTHENTICATION_SESSION");
  assert.deepEqual(authFiles, [],
    `these files are counted as sign-in identity but depend on Firebase for business data: ${authFiles.join(", ")}`);
});

test("the census is deterministic and groups the whole surface", () => {
  const rows = censusByDomain(paths);
  assert.equal(rows.reduce((n, r) => n + r.fileCount, 0), paths.length,
    "every business-dependent file must be counted exactly once");
  assert.deepEqual(rows.map((r) => r.domain), censusByDomain(paths).map((r) => r.domain));
  // Sorted by count descending, so the largest surface is the first thing a reader sees.
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].fileCount >= rows[i].fileCount);
});
