#!/usr/bin/env node
// PURCHASING ATTRIBUTION — read back from stored state, resolved against live authority.
//
// Every certification purchase order must name a buyer, that buyer must resolve to a real
// principal, and that principal must hold reorder.purchaseOrder.create right now. And no order may
// be attributed to a salesperson, a receiver, or the owner.
//
// The last clause matters as much as the first. An earlier fixture named salespeople as buyers and
// put-away operators as receivers, and every check it ran agreed with it, because every check
// compared the fixture to itself.
//
// EMULATOR OR eos-platform-sandbox, through the shared execution gate. Production is refused.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveReadOnlyTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const { loadPrincipalIndex, resolveCapability, PURCHASE } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));
const { CERT_BUYERS } = await import(L("functions/scripts/certificationWorld/data/purchasingPlan.mjs"));

/** Employees who must NEVER appear as a buyer on a certification order. */
const FORBIDDEN = ["cw-emp-035", "cw-emp-036", "cw-emp-044", "cw-emp-045", "cw-emp-000"];

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

// THE ONE GATE. Emulator and eos-platform-sandbox only; production refused two ways; a live
// write additionally requires --apply-live-sandbox. See executionTarget.mjs.
let __target;
try {
  __target = resolveReadOnlyTarget();
  setExecutionTarget(__target);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}
if (!__target) {
  // refused above
} else {
  console.log(describeTarget(__target));
  // Credentials follow the TARGET, not a hardcoded project. An emulator needs none; a live
  // project needs application-default credentials, and naming the project explicitly means the
  // app cannot silently initialize against whatever ADC happens to prefer.
  if (!getApps().length) {
    initializeApp(__target.isEmulator
      ? { projectId: __target.projectId }
      : { credential: applicationDefault(), projectId: __target.projectId });
  }
  const db = getFirestore();
  const principalIndex = await loadPrincipalIndex(db);

  const snap = await db.collection("purchase_orders").get();
  const certOrders = snap.docs.filter((d) => d.data().certBuyerEmployeeId);
  console.log(`purchase orders: ${snap.size}, carrying certification attribution: ${certOrders.length}\n`);

  check("every certification purchase order names a buyer", certOrders.length === snap.size,
    `${snap.size - certOrders.length} order(s) without attribution`);

  for (const doc of certOrders) {
    const d = doc.data();
    const employeeId = d.certBuyerEmployeeId;
    const cap = await resolveCapability(db, principalIndex, employeeId, PURCHASE);
    check(`${d.certIntent ?? doc.id}: buyer ${employeeId} holds ${PURCHASE}`, cap.allowed,
      `${cap.decision} via ${cap.roles.join("/") || "-"}`);
    check(`${d.certIntent ?? doc.id}: stored principal matches the employee link`,
      d.certBuyerPrincipalUid === cap.uid, `${d.certBuyerPrincipalUid} vs ${cap.uid}`);
    check(`${d.certIntent ?? doc.id}: buyer is one of the declared buyers`,
      CERT_BUYERS.includes(employeeId), employeeId);
  }

  const forbidden = certOrders.filter((d) => FORBIDDEN.includes(d.data().certBuyerEmployeeId));
  check("no order attributed to a salesperson, receiver, or the owner", forbidden.length === 0,
    forbidden.map((d) => `${d.id}=${d.data().certBuyerEmployeeId}`).join(", ") || "none");

  const perBuyer = new Map();
  for (const d of certOrders) perBuyer.set(d.data().certBuyerEmployeeId, (perBuyer.get(d.data().certBuyerEmployeeId) ?? 0) + 1);
  check("the orders are distributed across more than one buyer", perBuyer.size > 1,
    [...perBuyer].map(([b, n]) => `${b}=${n}`).join(", "));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} attribution checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
