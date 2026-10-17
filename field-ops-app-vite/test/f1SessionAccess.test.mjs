// FIREBASE EXIT F1 (DECISIONS #244) -- the session's capability vocabulary and action gates, proved against the EOS catalog.
// Run: node --test test/f1SessionAccess.test.mjs
//
// Where an EOS API is declared the shell asks the caller's own EOS capability set instead of the Firebase feed. Two things
// must be true for that to be honest, and both are checked against the migrations that DEFINE the EOS catalog -- not against
// a copy of it:
//   1. Every Firebase id the shell asks about is either an EOS key under the same name, translated to the EOS key with the SAME
//      meaning (and that key exists), or recorded as having no EOS twin and no reachable consumer. Nothing is inferred.
//   2. Every capability an action gate (G1..G7) is re-expressed as is a real EOS key.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EOS_KEY_FOR_FIREBASE_ID,
  FIREBASE_IDS_WITHOUT_EOS_TWIN,
  capabilitySignature,
  eosCapabilitiesFrom,
  eosKeyForFirebaseId,
} from "../src/access/eosCapabilityAccess.js";
import {
  NO_SESSION_ACCESS,
  SESSION_GATE_KEYS,
  WORK_ORDER_ACTION_CAPABILITY,
  scanJourneyRole,
  sessionDecision,
} from "../src/access/sessionAccess.js";
import { SHELL_GATED_CAPABILITY_IDS } from "../src/access/shellCapabilityGates.js";

// The Account record page asks for exactly these four (metadata/definitions/accountPage.js; pinned by metadataAccountPageDefinition).
const ACCOUNT_REQUEST_FOR_TEST = ["opportunity.read", "salesOrder.read", "finance.read", "crm.activity.read"];

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../functions/migrations");

/** Every capability key any migration registers (quoted dotted ids), plus the ids the seed snapshot names. */
const eosKeys = (() => {
  const keys = new Set();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const text = readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const m of text.matchAll(/'([a-z][A-Za-z]*(?:\.[a-zA-Z]+){1,4})'/g)) keys.add(m[1]);
  }
  return keys;
})();

test("every Firebase id the shell asks about is an EOS key, a same-meaning translation, or a recorded gap -- nothing is inferred", () => {
  const unaccounted = [];
  for (const id of [...SHELL_GATED_CAPABILITY_IDS, ...ACCOUNT_REQUEST_FOR_TEST]) {
    if (id in EOS_KEY_FOR_FIREBASE_ID) continue; // translated: checked below
    if (id in FIREBASE_IDS_WITHOUT_EOS_TWIN) continue; // recorded gap: checked below
    if (!eosKeys.has(id)) unaccounted.push(id);
  }
  assert.deepEqual(unaccounted, [], "a Firebase id with no EOS key, no translation and no recorded gap would be denied silently");
});

test("every translation targets a registered EOS key, and no id is both translated and a recorded gap", () => {
  for (const [firebaseId, eosKey] of Object.entries(EOS_KEY_FOR_FIREBASE_ID)) {
    assert.ok(eosKeys.has(eosKey), `${firebaseId} -> ${eosKey}: not a registered EOS capability`);
    assert.ok(!(firebaseId in FIREBASE_IDS_WITHOUT_EOS_TWIN), `${firebaseId} is both translated and a recorded gap`);
    assert.equal(eosKeyForFirebaseId(firebaseId), eosKey);
  }
  for (const id of Object.keys(FIREBASE_IDS_WITHOUT_EOS_TWIN)) {
    assert.ok(!eosKeys.has(id), `${id} IS an EOS key now -- remove it from the recorded gaps so it is asked under its own name`);
  }
  assert.equal(eosKeyForFirebaseId("customer.record.read"), "customer.record.read", "a shared id is asked under its own name");
});

test("admin.dataImport.stage is registered in EOS (migration 1764600000000), so the Data Import preview step is not dark for its administrator", () => {
  assert.ok(eosKeys.has("admin.dataImport.stage"));
  assert.ok(!("admin.dataImport.stage" in FIREBASE_IDS_WITHOUT_EOS_TWIN));
});

test("every action gate is re-expressed as capabilities that exist in EOS", () => {
  const all = new Set([...Object.values(SESSION_GATE_KEYS).flat(), ...Object.values(WORK_ORDER_ACTION_CAPABILITY)]);
  for (const key of all) assert.ok(eosKeys.has(key), `${key} is not a registered EOS capability`);
  // G3: the retired queue key is NOT used -- it is held by no Role, so it would deny the Administrator too.
  assert.ok(!all.has("reorder.request.read.queue"));
  assert.deepEqual([...SESSION_GATE_KEYS.reorderQueue], ["reorder.request.read"]);
  assert.deepEqual([...SESSION_GATE_KEYS.accountGovernedFields], ["customer.governedField.write"]);
});

test("sessionDecision: legacy answer when Firebase is the source, EOS capabilities (any-of) when EOS is", () => {
  const eos = (...held) => ({ eosSource: true, holds: (k) => held.includes(k) });
  assert.equal(sessionDecision(NO_SESSION_ACCESS, ["a"], true), true, "no provider: the legacy value, untouched");
  assert.equal(sessionDecision(NO_SESSION_ACCESS, ["a"], false), false);
  assert.equal(sessionDecision(undefined, ["a"], true), true);
  assert.equal(sessionDecision(eos("a"), ["a", "b"], false), true, "EOS holds one of the keys");
  assert.equal(sessionDecision(eos("c"), ["a", "b"], true), false, "EOS decides alone: a true legacy value grants nothing");
  assert.equal(sessionDecision(eos(), ["a"], true), false);
  assert.equal(sessionDecision({ eosSource: true, holds: () => "yes" }, ["a"], false), false, "only an explicit true counts");
});

test("scanJourneyRole: the technician journey is the work-execution capability under EOS, the legacy role elsewhere", () => {
  assert.equal(scanJourneyRole(NO_SESSION_ACCESS, "technician"), "technician");
  assert.equal(scanJourneyRole(NO_SESSION_ACCESS, "admin"), "admin");
  assert.equal(scanJourneyRole({ eosSource: true, holds: (k) => k === "workOrder.execution.record" }, null), "technician");
  assert.equal(scanJourneyRole({ eosSource: true, holds: () => false }, "technician"), null, "a legacy role is not consulted under EOS");
});

test("the G4 office actions map one-to-one onto Work Order lifecycle capabilities", () => {
  assert.deepEqual(Object.keys(WORK_ORDER_ACTION_CAPABILITY).sort(), ["Cancel", "Close", "Dispatch", "MarkReady", "Schedule", "Unschedule"]);
  assert.equal(WORK_ORDER_ACTION_CAPABILITY.Unschedule, WORK_ORDER_ACTION_CAPABILITY.Schedule, "returning to the queue is the schedule capability");
});

test("eosCapabilitiesFrom refuses every malformed shape (malformed is a fault, not an empty set)", () => {
  assert.deepEqual([...eosCapabilitiesFrom({ capabilities: ["a.b", "c.d"] })], ["a.b", "c.d"]);
  assert.deepEqual([...eosCapabilitiesFrom({ capabilities: [] })], []);
  for (const bad of [null, undefined, [], "x", 7, {}, { capabilities: "a.b" }, { capabilities: null }, { capabilities: [1] }, { capabilities: ["a.b", null] }, { capabilities: [""] }]) {
    assert.equal(eosCapabilitiesFrom(bad), null, JSON.stringify(bad));
  }
  assert.equal(capabilitySignature(new Set(["b", "a"])), capabilitySignature(new Set(["a", "b"])), "order does not matter");
  assert.notEqual(capabilitySignature(new Set(["a"])), capabilitySignature(new Set(["a", "b"])));
});

test("each legacy-role gate (G1-G7) is answered by sessionDecision at its one site, keeping the legacy value as the Firebase-source answer", () => {
  const read = (rel) => readFileSync(path.resolve(here, "../src", rel), "utf8").replace(/\r\n/g, "\n");
  const sites = [
    ["modules/dispatcherBoard/DispatcherBoard.jsx", /sessionDecision\(access, SESSION_GATE_KEYS\.dispatchBoard, role === "admin" \|\| role === "dispatcher"\)/], // G1
    ["modules/jobs/Jobs.jsx", /SESSION_GATE_KEYS\.workOrderCreate/], // G2
    ["shared/ui/NotificationControl.jsx", /SESSION_GATE_KEYS\.reorderQueue/], // G3
    ["modules/controlTower/WorkOrderActions.jsx", /WORK_ORDER_ACTION_CAPABILITY\[action\]/], // G4
    ["modules/accounts/AccountDetail.jsx", /SESSION_GATE_KEYS\.accountGovernedFields, role === "admin"/], // G5
    ["shared/inventory/RequestReorderControl.jsx", /SESSION_GATE_KEYS\.reorderManual/], // G6
    ["modules/mobile/PartsScanner.jsx", /scanJourneyRole\(useSessionAccess\(\)/], // G7
    ["App.jsx", /role: scanJourneyRole\(useSessionAccess\(\), role\)/], // G7 (the three Scan mounts)
  ];
  for (const [file, pattern] of sites) assert.match(read(file), pattern, `${file} no longer answers its F1 gate through the session seam`);
  // G8: the Firestore-only parts shadow diagnostic is retired where EOS is the source, and untouched where it is not.
  assert.match(read("App.jsx"), /\{!EOS_SESSION_SOURCE && \(\n\s+<Route path="\/admin\/diagnostics\/inventory-parts-parity"/);
  // The technician status pill (a fieldops_technicians fact with no EOS twin) is omitted rather than invented.
  assert.match(read("modules/technicianDashboard/TechnicianDashboard.jsx"), /technician && technician\.status !== undefined/);
});

test("the flag is the navigation seam, compile-time only: no runtime override and no fallback branch in the session sources", () => {
  // Comments may NAME Firebase (they explain what this replaced); code may not use it.
  const read = (rel) => readFileSync(path.resolve(here, "../src", rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const flag = read("access/eosSessionSource.js");
  assert.match(flag, /EOS_NAVIGATION_AUTHORITY_READY === true/);
  assert.doesNotMatch(flag, /localStorage|sessionStorage|URLSearchParams|location\./, "no runtime override seam");
  // the capability feed never reaches Firebase, and never reads a legacy role
  const feed = read("access/useEosCapabilityFeed.js");
  const NO_FIREBASE = /from\s+["'](?:\.\.?\/)*(?:firebase|firestore)[^"']*["']|httpsCallable|onSnapshot|getDoc\b/;
  assert.doesNotMatch(feed, NO_FIREBASE);
  assert.doesNotMatch(read("auth/eosEmployeeSession.js"), NO_FIREBASE);
  // role-change refetch fires from the one Administration client, for authority-changing operations only
  const client = read("services/adminPolicyApiClient.js");
  assert.match(client, /ACCESS_CHANGING_OPERATIONS\.includes\(operation\)\) notifyEosAccessChanged\(\)/);
});
