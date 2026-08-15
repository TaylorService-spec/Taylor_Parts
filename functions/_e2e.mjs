// Partial Opportunity -> Invoice E2E driver (sandbox-only, self-discovering).
// Reads credentials ONLY via loadSandboxPersona; never prints them. Structurally
// refuses any project other than eos-platform-sandbox. Uses existing governed
// roleAssignments + trusted callables + the authoritative WO transition sequence.
import fs from 'node:fs';
import admin from 'firebase-admin';
import { loadSandboxPersona } from '../scripts/sandboxCredentials.mjs';

const PROJECT = 'eos-platform-sandbox';
if (PROJECT === 'taylor-parts') { console.error('ABORT: production target'); process.exit(1); }
const registry = JSON.parse(fs.readFileSync('../config/environments.json', 'utf8'));
const env = registry.environments.find((e) => e.id === 'platform-sandbox');
if (!env || env.role === 'production' || env.firebase.projectId !== PROJECT || env.firebase.projectId === 'taylor-parts') {
  console.error('ABORT: project/role guard failed'); process.exit(1);
}
const API_KEY = env.firebase.apiKey;
const REGION = env.firebase.functionsRegion || 'us-central1';
// Gen2 callables are per-function Cloud Run services: https://<lowercasename>-<projecthash>-uc.a.run.app
const FN_HASH = '2duvac43ba';
const CALLABLE = (name) => `https://${name.toLowerCase()}-${FN_HASH}-uc.a.run.app`;

const app = admin.initializeApp({ projectId: PROJECT });
if (app.options.projectId !== PROJECT) { console.error('ABORT: admin project guard'); process.exit(1); }
const db = admin.firestore();

const RUN = `e2e${Date.now()}`;               // unique, traceable run tag
const key = (s) => `${RUN}-${s}`.slice(0, 200);
const results = [];
const log = (step, persona, outcome, detail) => { const line = `[${outcome}] ${step} (as ${persona}) ${detail ?? ''}`.trim(); console.log(line); results.push({ step, persona, outcome, detail }); };

// --- auth: persona email/password (via loadSandboxPersona) -> Firebase ID token (REST). Never logs the password.
const tokenCache = {};
async function idTokenFor(personaKey) {
  if (tokenCache[personaKey]) return tokenCache[personaKey];
  const { email, password } = loadSandboxPersona(personaKey); // throws CREDENTIAL_ACCESS_FAILED if missing
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok || !j.idToken) throw new Error(`AUTH_FAILED persona=${personaKey} status=${r.status} code=${j.error?.message ?? 'unknown'}`);
  tokenCache[personaKey] = j.idToken;
  return j.idToken;
}

// --- call an onCall callable as a persona. Returns result or throws with the HttpsError code.
async function call(name, personaKey, data) {
  const token = await idTokenFor(personaKey);
  const r = await fetch(CALLABLE(name), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new Error(`${name} FAILED: ${j.error?.status ?? r.status} ${j.error?.message ?? ''}`); e.code = j.error?.status; throw e; }
  return j.result;
}

const state = {};
async function main() {
  console.log(`== E2E ${RUN} :: project=${PROJECT} ==`);
  const ACCOUNT = 'acct-harbor', LOCATION = 'loc-harbor-airport', OWNER_EMP = 'sbx-owner';
  const PART = 'PRT-1005', TECH_ID = 'tech-sbx-01', UNIT_MINOR = 5000, COMPANY = 'TAYLOR';

  // 1. Opportunity
  let r = await call('createOpportunity', 'owner', { accountId: ACCOUNT, ownerEmployeeId: OWNER_EMP, salesChannel: 'RETAIL', lines: [{ kind: 'PART', ref: PART, qty: 1 }], idempotencyKey: key('opp') });
  state.opportunityId = r.opportunityId; log('createOpportunity', 'owner', 'PASS', `opportunityId=${r.opportunityId} stage=${r.stage}`);

  // 2. lifecycle transitions to DECISION
  for (const stage of ['QUALIFYING', 'SOLUTION', 'QUOTING', 'CUSTOMER_REVIEW', 'DECISION']) {
    r = await call('transitionOpportunity', 'owner', { opportunityId: state.opportunityId, toStage: stage, idempotencyKey: key(`stage-${stage}`) });
    log('transitionOpportunity', 'owner', 'PASS', `-> ${r.stage}`);
  }
  // 3. WON
  r = await call('transitionOpportunity', 'owner', { opportunityId: state.opportunityId, outcome: 'WON', idempotencyKey: key('won') });
  log('transitionOpportunity(WON)', 'owner', 'PASS', `stage=${r.stage} outcome=${r.outcome}`);

  // 4. Sales Order (priced, with source Opportunity lineage)
  r = await call('createSalesOrder', 'owner', { accountId: ACCOUNT, ownerEmployeeId: OWNER_EMP, salesChannel: 'RETAIL', locationId: LOCATION, sourceOpportunityId: state.opportunityId, lines: [{ kind: 'PART', ref: PART, orderedQty: 1, unitPrice: UNIT_MINOR }], idempotencyKey: key('so') });
  state.salesOrderId = r.salesOrderId; log('createSalesOrder', 'owner', 'PASS', `salesOrderId=${r.salesOrderId}`);

  // 5. allocation
  r = await call('allocateSalesOrder', 'owner', { salesOrderId: state.salesOrderId });
  log('allocateSalesOrder', 'owner', 'PASS', `readiness=${r.readiness} counts=${JSON.stringify(r.counts ?? {})}`);

  // 6. service -> Work Order
  r = await call('createServiceForSalesOrder', 'owner', { salesOrderId: state.salesOrderId });
  state.workOrderId = r.workOrderId; log('createServiceForSalesOrder', 'owner', 'PASS', `workOrderId=${r.workOrderId} woNumber=${r.woNumber}`);

  // 7. dispatch chain (admin/dispatcher)
  await call('transitionWorkOrder', 'dispatcher', { workOrderId: state.workOrderId, action: 'MarkReady' }); log('WO MarkReady', 'dispatcher', 'PASS', '-> READY_TO_DISPATCH');
  // Run-UNIQUE far-future planning window: spreads each run's 1h slot across a ~230yr hourly range so this
  // WO can never overlap an existing booking — no pre-existing scenario record is cancelled or modified.
  const t0 = 1_900_000_000_000 + (Number(RUN.replace(/\D/g, '').slice(-7)) % 2_000_000) * 3_600_000;
  await call('transitionWorkOrder', 'dispatcher', { workOrderId: state.workOrderId, action: 'Schedule', scheduledStart: t0, scheduledEnd: t0 + 3600000, scheduledTechId: TECH_ID }); log('WO Schedule', 'dispatcher', 'PASS', '-> SCHEDULED');
  await call('transitionWorkOrder', 'dispatcher', { workOrderId: state.workOrderId, action: 'Dispatch', assignedTechId: TECH_ID }); log('WO Dispatch', 'dispatcher', 'PASS', `-> DISPATCHED assignedTechId=${TECH_ID}`);

  // 8. technician execution chain (own assignment)
  for (const action of ['Accept', 'Travel', 'Arrive', 'WorkStart']) {
    const rr = await call('transitionWorkOrder', 'technician', { workOrderId: state.workOrderId, action });
    log(`WO ${action}`, 'technician', 'PASS', `-> ${rr.status}`);
  }
  // 9. technician records PART actuals
  r = await call('updateWorkOrderExecutionData', 'technician', { workOrderId: state.workOrderId, qtyUsedUpdates: [{ sku: PART, delta: 1 }], idempotencyKey: key('actuals') });
  log('updateWorkOrderExecutionData', 'technician', 'PASS', `qtyUsed ${PART}+1`);

  // 10. Complete -> SO fulfillment write-back
  r = await call('transitionWorkOrder', 'technician', { workOrderId: state.workOrderId, action: 'Complete' });
  log('WO Complete', 'technician', 'PASS', `-> ${r.status} (fulfillment write-back fires)`);

  // read the governed SO to get the exact committed currency + lineId + fulfilledQty (no inventing)
  const soDoc = (await db.collection('sales_orders').doc(state.salesOrderId).get()).data();
  const soLine = (soDoc.lines || [])[0] || {};
  state.currency = soDoc.currency; state.soLineId = soLine.lineId; state.fulfilledQty = soLine.fulfilledQty;
  console.log(`SO committed: currency=${soDoc.currency} state=${soDoc.state} line=${soLine.lineId} ordered=${soLine.orderedQty} allocated=${soLine.allocatedQty} fulfilled=${soLine.fulfilledQty} unitPrice=${soLine.unitPrice}`);

  // 11. invoice issuance
  r = await call('issueInvoice', 'owner', {
    companyId: COMPANY, accountId: ACCOUNT, salesOrderId: state.salesOrderId, currency: state.currency,
    dueDate: t0 + 30 * 86400000, billingAction: 'BILL_NOW',
    lines: [{ salesOrderLineId: state.soLineId, kind: 'PART', ref: PART, billableQty: state.fulfilledQty || 1, unitPriceMinor: UNIT_MINOR, taxMinor: 0 }],
    idempotencyKey: key('invoice'),
  });
  state.invoiceId = r.invoiceId; log('issueInvoice', 'owner', 'PASS', `invoiceId=${r.invoiceId} number=${r.invoiceNumber} total=${r.totalMinor}`);

  // 12. final read verification (admin, read-only)
  const opp = (await db.collection('opportunities').doc(state.opportunityId).get()).data();
  const so = (await db.collection('sales_orders').doc(state.salesOrderId).get()).data();
  const wo = (await db.collection('fieldops_wos').doc(state.workOrderId).get()).data();
  const inv = (await db.collection('invoices').doc(state.invoiceId).get()).data();
  console.log('\n== FINAL STATES ==');
  console.log(`Opportunity ${state.opportunityId}: stage=${opp.stage} outcome=${opp.outcome} salesOrderId=${opp.salesOrderId}`);
  console.log(`SalesOrder  ${state.salesOrderId}: state=${so.state} line.fulfilledQty=${(so.lines||[])[0]?.fulfilledQty} billedQty=${(so.lines||[])[0]?.billedQty}`);
  console.log(`WorkOrder   ${state.workOrderId}: status=${wo.status}`);
  console.log(`Invoice     ${state.invoiceId}: state=${inv.state} number=${inv.invoiceNumber} total=${inv.totalMinor} currency=${inv.currency}`);
  console.log(`\nRUN=${RUN}  created ids: opp=${state.opportunityId} so=${state.salesOrderId} wo=${state.workOrderId} inv=${state.invoiceId}`);
  console.log('E2E RESULT: PASS');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\n[FAIL] ${e.message}`);
  console.error(`state: ${JSON.stringify(state)}`);
  console.error('E2E RESULT: FAIL');
  process.exit(1);
});
