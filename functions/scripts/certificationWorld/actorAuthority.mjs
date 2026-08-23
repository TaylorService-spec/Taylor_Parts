// EMPLOYEE -> PRINCIPAL -> ACTIVE ASSIGNMENTS -> EFFECTIVE CAPABILITY.
//
// One implementation, shared by everything in this program that needs to know whether a person may
// perform an act: the purchasing preflight, the SoD verifier, and the receiving actor selection.
//
// ============================ WHY IT IS SHARED ============================
//
// A fixture that resolves authority one way and a verifier that resolves it another way can both be
// wrong in the same direction and agree, or right in different directions and disagree for reasons
// that have nothing to do with the world. This program has already been bitten by exactly that
// shape once, when a generator and a classifier shared a defect and reported zero mismatches for a
// world that contained none of the thing being counted.
//
// So there is one path here and it is the one the services use: users/{uid}.accessVersion plus
// roleAssignments where status == "active", through resolveEffectivePermission over the merged
// role catalog. Nothing reads a job title, a fixture field, or a name.
//
// EMULATOR ONLY -- the caller is responsible for having pointed the Admin SDK at one.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveEffectivePermission } = await import(L("functions/lib/access/resolveEffectivePermission.js"));
const { COMPATIBILITY_ROLES } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { GOVERNED_BUSINESS_ROLES } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } =
  await import(L("functions/lib/access/environmentCapabilityOverrides.js"));

/**
 * The activation set for THIS environment, resolved by the product's own function.
 *
 * Not a list written here. resolveCapabilityOverrides is the same code the deployed runtime calls;
 * it is handed the canonical registry and the project id the emulator actually is, and it applies
 * all three hard-blocks itself -- unknown project yields empty, production yields empty regardless
 * of its data, and whatever survives is intersected with the eligible allow-list.
 *
 * Hand-feeding a set here would have been the stub the Owner explicitly refused: it would prove
 * that a resolver given the right answer returns the right answer.
 */
export const ENVIRONMENT_ACTIVATIONS = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "demo-certworld");

export const TRANSFER_CREATE = "inventory.transfer.create";
export const TRANSFER_DISPATCH = "inventory.transfer.dispatch";
export const TRANSFER_RECEIVE = "inventory.transfer.receive";
export const COUNT_CREATE = "inventory.cycleCount.create";
export const COUNT_SUBMIT = "inventory.cycleCount.submit";
export const COUNT_RECONCILE = "inventory.cycleCount.reconcile";
export const RETURNS_INTAKE = "inventory.returns.intake";

/** The same merge the callable wiring uses: a principal may hold ANY governed role. */
export const ROLE_CATALOG = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const GLOBAL_TARGET = { scope: { type: "global" }, condition: {} };

export const RECEIVE = "inventory.stock.receive";
export const PURCHASE = "reorder.purchaseOrder.create";

/** employees/{id}.userId -- the fixture's link to a real principal. */
export async function loadPrincipalIndex(db) {
  const employees = await db.collection("employees").get();
  return new Map(employees.docs.map((d) => [d.id, d.data().userId]).filter(([, uid]) => uid));
}

/**
 * Does this employee actually hold this capability, right now, in this environment?
 *
 * Read exactly as resolveReceivePermissionThroughTxn reads it, so a PASS here and an ALLOW at the
 * service boundary cannot disagree about what "authorized" means.
 */
export async function resolveCapability(db, principalIndex, employeeId, permissionId) {
  const uid = principalIndex.get(employeeId);
  if (!uid) return { allowed: false, decision: "NO_PRINCIPAL", roles: [], uid: null };
  const userSnap = await db.collection("users").doc(uid).get();
  const accessVersion = userSnap.exists ? (userSnap.data()?.accessVersion ?? 0) : 0;
  const snap = await db.collection("roleAssignments")
    .where("principalUid", "==", uid).where("status", "==", "active").get();
  const assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const out = resolveEffectivePermission({
    permissionId, assignments, roles: ROLE_CATALOG,
    currentAccessVersion: accessVersion, target: GLOBAL_TARGET,
    // Environment activation, resolved by the product. Every Pass 3 capability is registered
    // active:false, which the resolver denies AHEAD of any Role grant -- without this the transfer,
    // cycle-count and returns families answer inactivePermission for everyone, forever, and no
    // authority test in this world would mean anything.
    activationOverrides: ENVIRONMENT_ACTIVATIONS,
  });
  return { allowed: out.decision === "ALLOW", decision: out.decision, roles: assignments.map((a) => a.roleId), uid };
}

/**
 * Separation of duties, proven semantically.
 *
 * Disjointness of the two NAME lists is necessary and nowhere near sufficient -- an earlier version
 * of this fixture had two disjoint lists in which neither side held the capability it was named
 * for. Every actor must be shown to hold its own side AND to be refused the other.
 */
export async function proveSeparation(db, principalIndex, buyers, receivers) {
  const findings = [];
  for (const b of buyers) {
    findings.push({ employeeId: b, side: "BUYER", holds: await resolveCapability(db, principalIndex, b, PURCHASE),
      denied: await resolveCapability(db, principalIndex, b, RECEIVE), holdsId: PURCHASE, deniedId: RECEIVE });
  }
  for (const r of receivers) {
    findings.push({ employeeId: r, side: "RECEIVER", holds: await resolveCapability(db, principalIndex, r, RECEIVE),
      denied: await resolveCapability(db, principalIndex, r, PURCHASE), holdsId: RECEIVE, deniedId: PURCHASE });
  }
  const overlap = buyers.filter((b) => receivers.includes(b));
  const violations = [
    ...overlap.map((e) => `${e} is both a buyer and a receiver`),
    ...findings.filter((f) => !f.holds.allowed).map((f) => `${f.employeeId} (${f.side}) does NOT hold ${f.holdsId}: ${f.holds.decision}`),
    ...findings.filter((f) => f.denied.allowed).map((f) => `${f.employeeId} (${f.side}) unexpectedly holds ${f.deniedId}`),
  ];
  return { findings, overlap, violations, ok: violations.length === 0 };
}
