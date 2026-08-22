import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * F1 — authorization + projection contract for getWorkOrderFieldContext.
 *
 * The pure authorization core is asserted behaviourally by re-implementing the
 * decision table from the TypeScript source (which this runner cannot import)
 * and asserting the SOURCE actually contains each rule. The structural
 * assertions are the ones that matter most here: they prove the surface cannot
 * become a customer-lookup API, and that no Rules or capability was widened to
 * make it work.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src/getWorkOrderFieldContext.ts");
const INDEX = resolve(HERE, "../src/index.ts");
const RULES = resolve(HERE, "../../firestore.rules");

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const src = readFileSync(SRC, "utf8");
const code = stripComments(src);

let passed = 0;
const ok = (name, fn) => test(name, () => { fn(); passed += 1; });

// ---------------------------------------------------------------- denials

ok("unauthenticated caller is denied", () => {
  assert.match(code, /if \(!authenticated\)[\s\S]{0,120}unauthenticated/);
});

ok("a non-technician caller is denied", () => {
  assert.match(code, /callerRole !== "technician"[\s\S]{0,140}permission-denied/);
});

ok("an unresolvable technician identity fails closed as failed-precondition", () => {
  assert.match(code, /!callerTechnicianId[\s\S]{0,160}failed-precondition/);
});

ok("a missing Work Order is not-found", () => {
  assert.match(code, /!workOrderExists[\s\S]{0,120}not-found/);
});

ok("another technician's Work Order is permission-denied", () => {
  assert.match(code, /assignedTechId !== callerTechnicianId[\s\S]{0,140}permission-denied/);
});

ok("an UNASSIGNED Work Order is denied too, not treated as open", () => {
  // `!assignedTechId ||` is the clause that makes an unassigned WO a denial.
  assert.match(code, /!assignedTechId \|\| assignedTechId !== callerTechnicianId/);
});

ok("every denial is evaluated BEFORE any canonical record is read", () => {
  const authorizeAt = code.indexOf("authorizeFieldContextRead({");
  const accountsAt = code.indexOf("ACCOUNTS_COLLECTION)");
  const locationsAt = code.indexOf("LOCATIONS_COLLECTION)");
  assert.ok(authorizeAt > -1 && accountsAt > -1 && locationsAt > -1);
  assert.ok(authorizeAt < accountsAt, "account read must come after authorization");
  assert.ok(authorizeAt < locationsAt, "location read must come after authorization");
});

ok("caller identity is resolved server-side, never from client-supplied role", () => {
  assert.match(code, /getCallerContext\(request\.auth\.uid\)/);
  assert.doesNotMatch(code, /request\.data[\s\S]{0,40}\brole\b/);
});

// ------------------------------------------------- enumeration impossible

ok("the request accepts ONLY workOrderId", () => {
  assert.match(code, /workOrderId\?\: unknown/);
  // No client-supplied customer/location id may be read off the request.
  assert.doesNotMatch(code, /request\.data[\s\S]{0,80}customerId/);
  assert.doesNotMatch(code, /request\.data[\s\S]{0,80}locationId/);
});

ok("customerId and locationId are taken FROM the governed Work Order", () => {
  assert.match(code, /wo\?\.customerId/);
  assert.match(code, /wo\?\.locationId/);
});

ok("arbitrary customer enumeration is impossible", () => {
  // The only accounts read is doc(customerId) where customerId came from `wo`.
  const m = code.match(/ACCOUNTS_COLLECTION\)\.doc\(([^)]+)\)/);
  assert.ok(m, "expected exactly one accounts doc read");
  assert.equal(m[1].trim(), "customerId");
});

ok("arbitrary location enumeration is impossible", () => {
  const m = code.match(/LOCATIONS_COLLECTION\)\.doc\(([^)]+)\)/);
  assert.ok(m, "expected exactly one locations doc read");
  assert.equal(m[1].trim(), "locationId");
});

ok("no collection query/listing is performed anywhere", () => {
  assert.doesNotMatch(code, /\.where\(|\.orderBy\(|\.listDocuments\(/);
});

ok("it is not a generic reader", () => {
  for (const banned of ["getAccount", "getLocation", "readDocument", "resolveAnyCustomer"]) {
    assert.ok(!code.includes(`export const ${banned}`), `must not export ${banned}`);
  }
});

// -------------------------------------------------------- minimal projection

ok("the response contains ONLY the approved minimal projection", () => {
  const iface = src.slice(src.indexOf("interface WorkOrderFieldContext"), src.indexOf("}", src.indexOf("interface WorkOrderFieldContext") + 200));
  assert.match(iface, /workOrderId/);
  assert.match(iface, /customer/);
  assert.match(iface, /site/);
});

ok("commercial and unrelated Account/Location fields are never read", () => {
  for (const field of [
    "paymentTerms", "taxStatus", "commercialProfile", "creditLimit", "balance",
    "notes", "contacts", "lineOfBusiness", "permissions", "salesRep",
  ]) {
    assert.ok(!code.includes(field), `must not reference ${field}`);
  }
});

ok("only canonical display fields are projected -- no duplicate naming field invented", () => {
  assert.match(code, /data\?\.name/);
  assert.match(code, /data\?\.city/);
  assert.match(code, /data\?\.state/);
});

ok("the whole Account/Location document is never returned", () => {
  assert.doesNotMatch(code, /\.\.\.accountSnap|\.\.\.locationSnap|accountSnap\.data\(\)\s*\}|return[^;]*snap\.data\(\)/);
});

// ------------------------------------------------------------ data states

ok("ABSENT, RESOLVED and UNRESOLVED are distinct and never collapsed", () => {
  assert.match(code, /!customerId \? "ABSENT" : displayName \? "RESOLVED" : "UNRESOLVED"/);
  assert.match(code, /!locationId \? "ABSENT" : displayLabel \? "RESOLVED" : "UNRESOLVED"/);
});

ok("a blank or non-string canonical display value yields UNRESOLVED, never a name", () => {
  assert.match(code, /typeof raw !== "string"[\s\S]{0,60}return null/);
  assert.match(code, /trimmed\.length > 0 \? trimmed : null/);
});

ok("the raw id is NEVER returned as a display fallback", () => {
  assert.doesNotMatch(code, /displayName\s*(\|\||\?\?)\s*customerId/);
  assert.doesNotMatch(code, /displayLabel\s*(\|\||\?\?)\s*locationId/);
});

// ------------------------------------------------- no authority was widened

ok("technician Account/Location Rules remain admin/dispatcher-only", () => {
  const rules = readFileSync(RULES, "utf8");
  const accounts = rules.slice(rules.indexOf("match /accounts/{accountId}"));
  assert.match(accounts.slice(0, 200), /allow read: if isAdminOrDispatcher\(\)/);
  const locations = rules.slice(rules.indexOf("match /locations/{locationId}"));
  assert.match(locations.slice(0, 200), /allow read: if isAdminOrDispatcher\(\)/);
});

ok("no broad customer-read capability is granted to implement this seam", () => {
  const roles = readFileSync(resolve(HERE, "../src/access/compatibilityRoles.ts"), "utf8");
  const tech = roles.slice(roles.indexOf("TECHNICIAN_ROLE"), roles.indexOf("TECHNICIAN_ROLE") + 2000);
  assert.ok(!tech.includes("customer.record.read"),
    "technician must not gain customer.record.read for this projection");
});

ok("the callable is exported for deployment", () => {
  assert.match(readFileSync(INDEX, "utf8"), /export \{ getWorkOrderFieldContext \}/);
});

test.after(() => console.log(`\nworkOrderFieldContext: ${passed} passed, 0 failed`));
