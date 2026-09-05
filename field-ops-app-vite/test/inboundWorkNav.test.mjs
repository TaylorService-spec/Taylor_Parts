// Email Connections + Inbound Work -- navigation and source-seam contract. Deterministic, node-only:
// no DOM, no firebase, no network.
//
// Run: node test/inboundWorkNav.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NAV_DOMAINS, SERVICE_NAV_GROUPS, isNavItemVisible } from "../src/navigation/navConfig.js";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants.js";
import {
  mapReadResult,
  normalizeCallableErrorCode,
  SOURCE_STATUS,
  INBOUND_WORK_CAPABILITY_REQUEST,
  EMAIL_INTAKE_CAPABILITY_REQUEST,
  governedEmailIntakeSource,
  governedInboundWorkSource,
} from "../src/access/inboundWorkSource.js";

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("PASS -- " + name);
}

const domain = (key) => NAV_DOMAINS.find((d) => d.key === key);
const item = (domainKey, itemKey) => domain(domainKey).subnav.find((i) => i.key === itemKey);
const allowed = (role) => ROLE_NAV_ACCESS[role] ?? [];
const withCapability = (...ids) => ({ hasCapability: (cap) => ids.includes(cap) });

ok("Service -> Inbound Work exists at its own path with no legacyKey", () => {
  const inbound = item("service", "inboundWork");
  assert.ok(inbound, "the Inbound Work subnav item is present");
  assert.equal(inbound.path, "inbound-work");
  assert.equal(inbound.legacyKey, undefined);
  assert.deepEqual(inbound.capabilityAccess, ["service.inboundWork.read"]);
});

ok("Inbound Work is CAPABILITY-gated, and fails closed for every role without it", () => {
  const inbound = item("service", "inboundWork");
  for (const role of [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.TECHNICIAN]) {
    assert.equal(
      isNavItemVisible(inbound, role, allowed(role), undefined),
      false,
      `${role} must not see Inbound Work without the governed capability`,
    );
  }
  assert.equal(isNavItemVisible(inbound, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN), withCapability("service.inboundWork.read")), true);
});

ok("a loading or errored capability feed does not reveal the destination", () => {
  const inbound = item("service", "inboundWork");
  for (const context of [{}, { hasCapability: null }, { hasCapability: () => undefined }, { hasCapability: () => false }]) {
    assert.equal(isNavItemVisible(inbound, ROLES.ADMIN, allowed(ROLES.ADMIN), context), false);
  }
});

ok("Inbound Work is grouped with the other Work Management destinations", () => {
  const group = SERVICE_NAV_GROUPS.find((g) => g.key === "workManagement");
  assert.ok(group.itemKeys.includes("inboundWork"));
});

ok("Administration -> Email & Communications is one destination, capability-gated", () => {
  const email = item("administration", "emailCommunications");
  assert.ok(email, "the Email & Communications subnav item is present");
  assert.equal(email.path, "email-communications");
  assert.deepEqual(email.capabilityAccess, ["administration.emailIntake.read"]);
  assert.equal(isNavItemVisible(email, ROLES.ADMIN, allowed(ROLES.ADMIN), undefined), false);
  assert.equal(isNavItemVisible(email, ROLES.ADMIN, allowed(ROLES.ADMIN), withCapability("administration.emailIntake.read")), true);
});

ok("the Service capability does not open the Administration destination, and vice versa", () => {
  const inbound = item("service", "inboundWork");
  const email = item("administration", "emailCommunications");
  assert.equal(isNavItemVisible(email, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN), withCapability("service.inboundWork.read")), false);
  assert.equal(isNavItemVisible(inbound, ROLES.TECHNICIAN, allowed(ROLES.TECHNICIAN), withCapability("administration.emailIntake.manage")), false);
});

ok("neither destination steals a domain index route", () => {
  assert.notEqual(item("service", "inboundWork").path, "");
  assert.notEqual(item("administration", "emailCommunications").path, "");
});

// ── The source seam ──────────────────────────────────────────────────────────────────────────────
ok("every capability decision a screen needs is resolved in ONE request", () => {
  assert.deepEqual(
    [...INBOUND_WORK_CAPABILITY_REQUEST],
    ["service.inboundWork.read", "service.inboundWork.accept", "service.inboundWork.decline", "service.inboundWork.attachExisting"],
  );
  assert.deepEqual([...EMAIL_INTAKE_CAPABILITY_REQUEST], ["administration.emailIntake.read", "administration.emailIntake.manage"]);
});

ok("denied and unavailable stay distinguishable -- an unauthorized read is not an empty one", () => {
  assert.equal(mapReadResult({ ok: false, errorCode: "permission-denied" }).status, SOURCE_STATUS.DENIED);
  assert.equal(mapReadResult({ ok: false, errorCode: "internal" }).status, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(mapReadResult({ ok: false }).status, SOURCE_STATUS.UNAVAILABLE);
  const ready = mapReadResult({ ok: true, payload: { rows: [] } });
  assert.equal(ready.status, SOURCE_STATUS.READY);
  assert.deepEqual(ready.payload.rows, []);
});

ok("a malformed success is treated as unavailable, never as a ready empty result", () => {
  assert.equal(mapReadResult({ ok: true, payload: null }).status, SOURCE_STATUS.UNAVAILABLE);
  assert.equal(mapReadResult({ ok: true, payload: "nope" }).status, SOURCE_STATUS.UNAVAILABLE);
});

ok("callable error codes are normalized before anything branches on them", () => {
  assert.equal(normalizeCallableErrorCode({ code: "functions/permission-denied" }), "permission-denied");
  assert.equal(normalizeCallableErrorCode({ code: "internal" }), "internal");
  assert.equal(normalizeCallableErrorCode(null), "");
});

// ── Two structural properties, asserted against the source rather than trusted ───────────────────
const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

ok("the client reaches this feature ONLY through trusted callables -- no direct Firestore access", () => {
  const source = read("../src/access/inboundWorkSource.js");
  for (const forbidden of ["firebase/firestore", "onSnapshot", "getDocs", "collection("]) {
    assert.equal(source.includes(forbidden), false, `the source seam must not use ${forbidden}`);
  }
  assert.match(source, /httpsCallable/);
});

ok("inbound message content is never rendered as markup", () => {
  for (const relative of ["../src/modules/service/InboundWorkWorkspace.jsx", "../src/modules/administration/AdminEmailCommunications.jsx"]) {
    const source = read(relative);
    // The ATTRIBUTE form, not the bare word: both files say in a comment that they must never use it,
    // and a check that fails on its own warning would be deleted the first time somebody hit it.
    assert.equal(/dangerouslySetInnerHTML\s*=/.test(source), false, `${relative} must not render HTML from a message`);
    // The plain-text projection is the only body the screen knows about; the stored markup field is not
    // referenced anywhere in the client at all.
    assert.equal(/\boriginalBody\b(?!Text)/.test(source), false, `${relative} must read only originalBodyText`);
  }
});

// ── Real provider transport ──────────────────────────────────────────────────────────────────────
ok("the real connection lifecycle is reachable from the client, and only through callables", () => {
  for (const action of ["startAuthorization", "completeAuthorization", "testConnection", "disconnect", "pollNow", "retryDelivery", "getProviderReadiness"]) {
    assert.equal(typeof governedEmailIntakeSource[action], "function", `${action} is missing from the source seam`);
  }
  assert.equal(typeof governedInboundWorkSource.getAttachment, "function");
});

ok("no transport action reaches Firestore directly either", () => {
  const source = read("../src/access/inboundWorkSource.js");
  for (const forbidden of ["firebase/firestore", "getStorage", "getDownloadURL", "ref("]) {
    assert.equal(source.includes(forbidden), false, `the source seam must not use ${forbidden}`);
  }
});

console.log(`\n${passed} passed`);
