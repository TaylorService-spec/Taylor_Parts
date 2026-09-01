// Receiving North Star P1 frame 1a — the Awaiting-receipt queue view-model
// (domain/receivingWorkspaceQueue.js) and the workspace's source contracts.
//
// The queue is the union of the two EXISTING governed candidate reads with an explicit Journey
// column (RCV-D1). These tests pin the truth rules the design brief names:
//   - a failed read NEVER fabricates rows or downgrades to "empty"
//   - EMPTY is a claim only both-READY may make; DENIED / UNAVAILABLE / FAILED stay distinct
//   - one readable source renders as an explicitly INCOMPLETE queue, never a silently complete one
//   - no document id is ever promoted to an order reference (RCV-G5; RR numbering is unwired)
//   - no receipt progress is fabricated for rows the list read carries none for (RCV-G6)
// and the frame's no-new-authority contract: the module is pure, and the workspace component
// introduces no receipt mutation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildReceivingWorkspaceQueue,
  buildReorderQueueRow,
  buildSupplierQueueRow,
  describeSourceBlock,
  JOURNEY_WORDS,
  QUEUE_SOURCE_STATE,
  QUEUE_STATE,
  RECEIVING_JOURNEY,
} from "../src/domain/receivingWorkspaceQueue.js";
import { PURCHASE_ORDERS_STATUS } from "../src/domain/purchaseOrdersView.js";
import { RECEIVING_OUTCOME } from "../src/domain/receivingTransport.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(HERE, "..", p), "utf8");

// ── fixtures ────────────────────────────────────────────────────────────────────────────

const readyReorderView = (rows = []) => ({ status: PURCHASE_ORDERS_STATUS.READY, rows });
const readySupplierList = (purchaseOrders = []) => ({ status: RECEIVING_OUTCOME.READY, purchaseOrders });

const candidate = (over = {}) => ({
  isReceiptCandidate: true,
  reorderRequestId: "reorder-doc-8Zk2",
  partId: "X49463-3",
  externalPoNumber: "TP-88112",
  supplierName: "Taylor Distribution",
  orderedQuantity: 12,
  ...over,
});

const supplierPo = (over = {}) => ({
  purchaseOrderId: "fs-auto-id-9pQ7xW",
  supplierId: "sup-1",
  storedStatus: "SENT",
  lineCount: 6,
  ...over,
});

// ── the union, when both sources read ───────────────────────────────────────────────────

test("both sources READY → one queue, supplier sessions first, each row naming its journey", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([candidate()]),
    supplierList: readySupplierList([supplierPo()]),
    supplierNamesById: { "sup-1": "Taylor Distribution" },
  });
  assert.equal(q.state, QUEUE_STATE.READY);
  assert.equal(q.rows.length, 2);
  assert.equal(q.rows[0].journey, RECEIVING_JOURNEY.SUPPLIER);
  assert.equal(q.rows[0].journeyWords, JOURNEY_WORDS.SUPPLIER);
  assert.equal(q.rows[1].journey, RECEIVING_JOURNEY.REORDER);
  assert.equal(q.rows[1].journeyWords, JOURNEY_WORDS.REORDER);
  assert.equal(q.notices.length, 0);
});

test("both READY with zero rows is the ONLY way to reach EMPTY", () => {
  const q = buildReceivingWorkspaceQueue({ reorderView: readyReorderView(), supplierList: readySupplierList() });
  assert.equal(q.state, QUEUE_STATE.EMPTY);
});

test("non-candidate reorder rows (RECEIVED / VOIDED / ORPHAN) are never reclassified into the queue", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([candidate({ isReceiptCandidate: false })]),
    supplierList: readySupplierList(),
  });
  assert.equal(q.state, QUEUE_STATE.EMPTY);
  assert.equal(q.rows.length, 0);
});

// ── truth ladder: loading / empty / denied / unavailable / failed stay distinct ─────────

test("either source still loading → LOADING, no rows shown early", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: { status: PURCHASE_ORDERS_STATUS.LOADING, rows: [] },
    supplierList: readySupplierList([supplierPo()]),
  });
  assert.equal(q.state, QUEUE_STATE.LOADING);
  assert.equal(q.rows.length, 0);
});

test("MUTATION PROOF: a failed read never becomes an empty queue", () => {
  // If someone 'simplifies' the ladder so a failure falls through to EMPTY, this fails.
  const q = buildReceivingWorkspaceQueue({
    reorderView: { status: PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE, rows: [] },
    supplierList: { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] },
  });
  assert.notEqual(q.state, QUEUE_STATE.EMPTY);
  assert.equal(q.rows.length, 0);
  assert.equal(q.notices.length, 2);
});

test("both DENIED → DENIED; both transport-unavailable → UNAVAILABLE; mixed → FAILED with each source's own sentence", () => {
  const denied = buildReceivingWorkspaceQueue({
    reorderView: { status: PURCHASE_ORDERS_STATUS.BLOCKED_PERMISSION, rows: [] },
    supplierList: { status: RECEIVING_OUTCOME.DENIED, purchaseOrders: [] },
  });
  assert.equal(denied.state, QUEUE_STATE.DENIED);

  const unavailable = buildReceivingWorkspaceQueue({
    // The reorder read has no transport-off state; only the supplier callable does — so
    // whole-queue UNAVAILABLE requires both, and this mixed case must be FAILED instead.
    reorderView: { status: PURCHASE_ORDERS_STATUS.BLOCKED_UNAVAILABLE, rows: [] },
    supplierList: { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] },
  });
  assert.equal(unavailable.state, QUEUE_STATE.FAILED);
  const sentences = unavailable.notices.map((n) => n.message).join(" ");
  assert.match(sentences, /not switched on/);
  assert.match(sentences, /could not be loaded/);
  assert.doesNotMatch(sentences, /not authorized/);
});

test("one source readable → READY_PARTIAL: the rows show AND the unread source is disclosed", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([candidate()]),
    supplierList: { status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] },
  });
  assert.equal(q.state, QUEUE_STATE.READY_PARTIAL);
  assert.equal(q.rows.length, 1);
  assert.equal(q.notices.length, 1);
  assert.equal(q.notices[0].journey, RECEIVING_JOURNEY.SUPPLIER);
  assert.match(q.notices[0].message, /cannot be read/);
});

test("READY_PARTIAL with zero readable rows still never claims empty", () => {
  const q = buildReceivingWorkspaceQueue({
    reorderView: readyReorderView([]),
    supplierList: { status: RECEIVING_OUTCOME.DENIED, purchaseOrders: [] },
  });
  assert.equal(q.state, QUEUE_STATE.READY_PARTIAL);
  assert.notEqual(q.state, QUEUE_STATE.EMPTY);
});

test("the three block sentences make three different claims", () => {
  const d = describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, QUEUE_SOURCE_STATE.DENIED);
  const u = describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, QUEUE_SOURCE_STATE.UNAVAILABLE);
  const f = describeSourceBlock(RECEIVING_JOURNEY.SUPPLIER, QUEUE_SOURCE_STATE.FAILED);
  assert.equal(new Set([d, u, f]).size, 3);
  assert.match(d, /not authorized/);
  assert.match(u, /not an empty list/);
});

// ── identity truth: no document id ever becomes a reference ─────────────────────────────

test("MUTATION PROOF: the canonical PO document id is never promoted to an order reference (RCV-G5)", () => {
  const row = buildSupplierQueueRow(supplierPo(), {});
  assert.equal(row.orderReference, null);
  // The id travels ONLY as the opaque navigation argument.
  assert.equal(row.open.purchaseOrderId, "fs-auto-id-9pQ7xW");
  for (const [k, v] of Object.entries(row)) {
    if (k === "open") continue;
    assert.notEqual(v, "fs-auto-id-9pQ7xW", `row.${k} must not carry the document id`);
  }
});

test("a reorder row renders its governed external PO number and NEVER the reorderRequestId", () => {
  const withNumber = buildReorderQueueRow(candidate());
  assert.equal(withNumber.orderReference, "TP-88112");

  const withoutNumber = buildReorderQueueRow(candidate({ externalPoNumber: null }));
  assert.equal(withoutNumber.orderReference, null, "absence is stated, not substituted");
  assert.equal(withoutNumber.open.reorderRequestId, "reorder-doc-8Zk2");
  for (const [k, v] of Object.entries(withoutNumber)) {
    if (k === "open") continue;
    assert.notEqual(v, "reorder-doc-8Zk2", `row.${k} must not carry the document id`);
  }
});

test("a legitimately long, machine-shaped external PO number is ACCEPTED as the reference", () => {
  // The first deployed Quick Gate (0abc2353) rejected `PO-LIVE-1788220473108` with an id-shape
  // heuristic — a gate false positive against a governed externalPoNumber value. Field provenance
  // is proved HERE, not inferred from string shape: whatever the governed field holds, renders.
  const row = buildReorderQueueRow(candidate({ externalPoNumber: "PO-LIVE-1788220473108" }));
  assert.equal(row.orderReference, "PO-LIVE-1788220473108");
});

test("PROVENANCE PIN: orderReference comes from externalPoNumber and NOTHING else", () => {
  // The correct live-gate/source split — the live gate proves what the operator sees; this proves
  // which governed field supplied it. Rewiring either builder's reference to a document id fails.
  const src = read("src/domain/receivingWorkspaceQueue.js");
  const reorderBuilder = src.slice(src.indexOf("function buildReorderQueueRow"), src.indexOf("// ─────────────────────────────────────────────── the combined queue"));
  assert.match(reorderBuilder, /orderReference: typeof row\.externalPoNumber/);
  assert.doesNotMatch(reorderBuilder, /orderReference:[^,\n]*reorderRequestId/);
  const supplierBuilder = src.slice(src.indexOf("function buildSupplierQueueRow"), src.indexOf("function buildReorderQueueRow"));
  assert.match(supplierBuilder, /orderReference: null/);
  assert.doesNotMatch(supplierBuilder, /orderReference:[^,\n]*purchaseOrderId/);
  // The ids appear ONLY inside the opaque navigation argument.
  assert.match(supplierBuilder, /open: \{ journey: RECEIVING_JOURNEY\.SUPPLIER, purchaseOrderId: po\.purchaseOrderId \}/);
  assert.match(reorderBuilder, /open: \{ journey: RECEIVING_JOURNEY\.REORDER, reorderRequestId: row\.reorderRequestId \}/);
});

test("GATE CONTRACT: the corrected Quick Gate asserts the real crumb and never infers provenance from shape", () => {
  // Pins the two corrections so the false negative and the false positive cannot quietly return.
  const gate = read(".claude/skills/run-field-ops-app-vite/receivingNorthStarQuickGate.mjs");
  // Crumb: the actual element, strict equality on the full directional relationship — removing
  // the crumb, duplicating it, or losing either side fails the live gate.
  assert.match(gate, /page\.locator\("\.ns-page__context"\)/);
  assert.match(gate, /=== "Inventory → Receiving"/);
  assert.match(gate, /\(await crumb\.count\(\)\) === 1/);
  // Order reference: journey-conditional truth, no id-shape heuristic anywhere.
  assert.match(gate, /orderPrimary !== "No order number recorded"/);
  assert.doesNotMatch(gate, /\{18,28\}|id-?shaped token/i);
});

test("MUTATION PROOF: no RR-number is synthesized while the RR lane is unwired (RCV-G4)", () => {
  // The allocator exists but nothing calls it, so no reorder document carries a number — a queue
  // that prints one would be claiming numbering is live. Any RR-shaped string in a built row fails.
  const row = buildReorderQueueRow(candidate({ externalPoNumber: null }));
  const flat = JSON.stringify(row);
  assert.doesNotMatch(flat, /RR-\d{4}-\d{6}/);
});

test("supplier names resolve through the provided map and degrade to a stated absence — never the supplierId", () => {
  const resolved = buildSupplierQueueRow(supplierPo(), { "sup-1": "Taylor Distribution" });
  assert.equal(resolved.supplierName, "Taylor Distribution");
  const unresolved = buildSupplierQueueRow(supplierPo(), {});
  assert.equal(unresolved.supplierName, null);
  assert.notEqual(unresolved.supplierName, "sup-1");
});

test("canonical stored statuses map to words; an unknown stored value passes through verbatim", () => {
  assert.equal(buildSupplierQueueRow(supplierPo({ storedStatus: "SENT" }), {}).statusWords, "Sent to supplier");
  assert.equal(buildSupplierQueueRow(supplierPo({ storedStatus: "APPROVED" }), {}).statusWords, "Approved");
  assert.equal(buildSupplierQueueRow(supplierPo({ storedStatus: "SOMETHING_NEW" }), {}).statusWords, "SOMETHING_NEW");
});

// ── no fabricated progress (RCV-G6) ─────────────────────────────────────────────────────

test("rows carry NO receipt-progress claim — the list read does not expose one", () => {
  const rows = [buildSupplierQueueRow(supplierPo(), {}), buildReorderQueueRow(candidate())];
  for (const row of rows) {
    const flat = JSON.stringify(row);
    assert.doesNotMatch(flat, /progress|Not started|Partially received/i);
  }
});

// ── frame contracts: purity, and no new mutation path in the workspace ──────────────────

test("the queue view-model is pure — no service, firebase, or hook import", () => {
  const src = read("src/domain/receivingWorkspaceQueue.js");
  assert.doesNotMatch(src, /from "\.\.\/services\//);
  assert.doesNotMatch(src, /from "firebase/);
  assert.doesNotMatch(src, /from "react"/);
});

test("MUTATION PROOF: the Receiving workspace introduces no receipt mutation", () => {
  // Frame 1a is reads + navigation. The two journey components own the governed submits; the
  // workspace itself must import none of them. (The acquire dialog is composed, not reimplemented.)
  const src = read("src/modules/inventory/Receiving.jsx");
  assert.doesNotMatch(src, /submitReceiveInventoryStock|submitCanonicalReceive|submitReceive|acquireSerializedAsset/);
});

test("MUTATION PROOF: no scan/type-an-order-number entry returns without a governed identifier contract (RCV-G7)", () => {
  // No governed scan-identifier or business-number authority exists for canonical purchase orders
  // (RCV-G5). The workspace records the gap and offers no field claiming otherwise; reinstating one
  // without first removing the recorded gap fails here.
  const src = read("src/modules/inventory/Receiving.jsx");
  assert.match(src, /AUTHORITY GAP — DO NOT INVENT \(RCV-G7\)/);
  assert.doesNotMatch(src, /type its number/i);
  assert.doesNotMatch(src, /placeholder="Scan/i);
});

test("frame 1b recomposition changed presentation only — same submit path, no new resolver, no scan-order claim", () => {
  const src = read("src/modules/receiving/MultiScanReceiving.jsx");
  // The one governed submit, reached only through the readiness-gated client.
  assert.match(src, /submitCanonicalReceive/);
  assert.doesNotMatch(src, /httpsCallable|from "firebase/);
  // No scanner resolver was created or imported — a part scan still matches the governed line
  // facts, and no purchase-order scan identifier exists to resolve (RCV-G7).
  assert.doesNotMatch(src, /aliasScan|scanResolver|resolveScan/i);
  assert.doesNotMatch(src, /[Ss]can (the|an?) (purchase )?order/);
  // The opaque ids never render as labels: the session title is the supplier fact, the picker
  // demotes its id to code, and the receipt states the missing RO number rather than receivingId.
  assert.doesNotMatch(src, /<h2[^>]*>\{progress\.purchaseOrderId\}/);
  assert.doesNotMatch(src, /Receipt \{receipt\.receivingId\}/);
});

test("frame 1d recomposition changed presentation only — same submit path, no new authority", () => {
  const src = read("src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx");
  // The one governed submit, reached only through the readiness-gated client — no new transport,
  // callable, command, resolver, or numbering implementation.
  assert.match(src, /submitReceiveInventoryStock/);
  assert.doesNotMatch(src, /httpsCallable|from "firebase/);
  assert.doesNotMatch(src, /aliasScan|scanResolver|resolveScan/i);
  assert.doesNotMatch(src, /RR-\$\{|`RR-/);
  // The opaque reorderRequestId never renders: not as the title and not as the review's
  // purchase-order fallback (the exact defect this frame removed).
  assert.doesNotMatch(src, /externalPoNumber \?\? candidate\.reorderRequestId/);
  assert.doesNotMatch(src, /externalPoNumber \?\? c\.reorderRequestId/);
  // Full-quantity contract intact: the received quantity is still the ordered quantity, derived in
  // the domain builder — no quantity input exists on this surface.
  assert.doesNotMatch(src, /type="number"|spinbutton/);
});

test("frame 1c re-hosting changed presentation only — same command, closed reasons, no new authority", () => {
  const acquire = read("src/modules/receiving/AcquireExistingUnit.jsx");
  // The one governed command, through its existing client — no new callable/command/transport.
  assert.match(acquire, /callAcquireSerializedAsset/);
  assert.doesNotMatch(acquire, /httpsCallable|from "firebase/);
  // No location resolver of its own, no Equipment creation, no receiving-order creation.
  assert.doesNotMatch(acquire, /createEquipment|installSerializedAsset|receiveInventoryStock|receiving_orders/);
  // The sheet is the SHARED Modal primitive, not a new overlay system.
  assert.match(acquire, /from "\.\.\/\.\.\/shared\/ui\/Modal\.jsx"/);
  // The reason vocabulary remains the closed governed set of exactly three — a fourth value, or a
  // coercion of an unknown one, is unrepresentable while this holds.
  const vocab = read("src/domain/serializedAssetAcquireVocabulary.js");
  for (const reason of ["OPENING_BALANCE", "LEGACY_MIGRATION", "EXISTING_COMPANY_ASSET"]) {
    assert.match(vocab, new RegExp(reason), `${reason} must remain in the closed set`);
  }
  const reasonTokens = vocab.match(/[A-Z][A-Z_]+: "(OPENING_BALANCE|LEGACY_MIGRATION|EXISTING_COMPANY_ASSET|[A-Z_]+)"/g) ?? [];
  assert.ok(!/(OTHER|ADJUSTMENT|CORRECTION|FOUND)/.test(reasonTokens.join(" ")), "no new reason value may appear");
});

// ── frame 1e — FAMILY-LEVEL truth pins, swept across all four merged frames ─────────────

const FAMILY_SURFACES = [
  "src/modules/inventory/Receiving.jsx",
  "src/modules/receiving/MultiScanReceiving.jsx",
  "src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx",
  "src/modules/receiving/AcquireExistingUnit.jsx",
  "src/domain/receivingWorkspaceQueue.js",
];

test("FAMILY PIN: no surface synthesizes an RR/PO/RO business number", () => {
  for (const path of FAMILY_SURFACES) {
    const src = read(path);
    assert.doesNotMatch(src, /`RR-|`PO-|`RO-|"RR-\d|"PO-\d|"RO-\d/, `${path} must not manufacture a business number`);
  }
});

test("FAMILY PIN: no purchase-order scan-identity claim anywhere (RCV-G7)", () => {
  // The RCV-G4 discipline: a corrected surface may QUOTE the forbidden claim in the comment that
  // records the gap — so a line carrying the phrase passes only when it names the gap it records.
  for (const path of FAMILY_SURFACES) {
    const lines = read(path).split("\n");
    const offenders = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /[Ss]can (the|an?) (purchase )?order|type its number/i.test(line))
      // The recording comment block names the gap within a few lines of the quotation.
      .filter(({ i }) => !lines.slice(Math.max(0, i - 6), i + 1).some((l) => /RCV-G7/.test(l)))
      .map(({ line }) => line.trim());
    assert.deepEqual(offenders, [], `${path} must not claim a PO scan identity`);
  }
});

test("FAMILY PIN: no surface renders a raw backend error message", () => {
  // Family error copy is sanitized vocabulary; the raw Error object's own text never reaches the
  // screen. (Codes/status tokens from the bounded transport vocabulary are permitted.)
  for (const path of FAMILY_SURFACES) {
    const src = read(path);
    assert.doesNotMatch(src, /\{\s*(err|error|e)\.message\s*\}|error\?\.message/, `${path} must not print err.message`);
    assert.doesNotMatch(src, /\.stack\b/, path);
  }
});

test("FAMILY PIN: the 1b destination picker keeps the location read's status (never options-only)", () => {
  // The frame-1e defect, made unrepresentable: consuming `res.options ?? []` while discarding
  // `res.status` is how a denied read became an innocently empty picker.
  const src = read("src/modules/receiving/MultiScanReceiving.jsx");
  assert.match(src, /setLocations\(\{ status: res\.status, options: res\.options \?\? \[\] \}\)/);
  // And the raw locationId is not a fallback label for an option.
  assert.doesNotMatch(src, /o\.label \?\? o\.locationId/);
});

test("FAMILY PIN: frame 1e introduced no new authority surface", () => {
  for (const path of FAMILY_SURFACES) {
    const src = read(path);
    assert.doesNotMatch(src, /httpsCallable|from "firebase\/functions"/, path);
    assert.doesNotMatch(src, /READINESS_OVERRIDE|_TRANSPORT_READY\s*=/, `${path} must not define/override readiness`);
  }
});

// ── frame 1f — handheld structural pins (the stylesheet contracts the measured pass relies on) ──
// Layout was measured in a real browser (375/320/768/1440) against rendered family states; jsdom
// computes none of it, so what CI holds in place is the exact stylesheet structure that produced
// those measurements. Removing any of these rules is how the measured result silently rots.

const css = () => read("src/index.css");

test("FRAME 1f PIN: both family tables carry the stacked handheld recomposition, and no receiving rule forces a pan", () => {
  const s = css();
  // The queue and the reconciliation table both stack at ≤640px: hidden thead + block rows +
  // labelled flex cells reading from data-label.
  for (const cls of ["fo-receiving-queue", "fo-receiving-session__table"]) {
    assert.match(s, new RegExp(`\\.${cls} thead \\{ position: absolute;`), `${cls}: thead visually hidden on phone`);
    assert.match(s, new RegExp(`\\.${cls}[^{]*td \\{ display: block; \\}|\\.${cls}, \\.${cls} tbody, \\.${cls} tr,?\\s*\\n?\\s*\\.?${cls}? ?td \\{ display: block; \\}|\\.${cls} td \\{ border: 0;`), `${cls}: stacked cells`);
    assert.match(s, new RegExp(`\\.${cls} td::before \\{ content: attr\\(data-label\\)`), `${cls}: labels come from data-label`);
  }
  // MUTATION PROOF: no receiving-family selector may pin a fixed width wider than a 375px handheld
  // (max-width caps are fine; fixed width floors are how tables come to pan).
  const receivingRules = s.match(/\.fo-receiving[^{}]*\{[^}]*\}|\.fo-reorder[^{}]*\{[^}]*\}|\.fo-acquire[^{}]*\{[^}]*\}|\.fo-modal--sheet[^{}]*\{[^}]*\}/g) ?? [];
  for (const rule of receivingRules) {
    assert.doesNotMatch(rule, /(?<!max-)(?<!min-)width:\s*(3[89]\d|[4-9]\d\d|\d{4,})px/, `fixed over-wide width in: ${rule.slice(0, 70)}`);
    assert.doesNotMatch(rule, /min-width:\s*(3[89]\d|[4-9]\d\d|\d{4,})px/, `min-width pan floor in: ${rule.slice(0, 70)}`);
  }
});

test("FRAME 1f PIN: the sheet is full-width at handheld and long values keep wrap protection", () => {
  const s = css();
  assert.match(s, /@media \(max-width: 640px\) \{ \.fo-modal--sheet \{ max-width: 100%;/);
  // MUTATION PROOF: the review read-back's long-value wrap (serial lists) survives.
  assert.match(s, /\.fo-receive-confirm dd \{ overflow-wrap: anywhere; \}/);
});

test("FRAME 1f PIN: the measured touch-floor fix stands — workspace link-buttons clear 44px on phones", () => {
  const s = css();
  const block = s.match(/\.fo-receiving-workspace \.fo-link-btn \{[^}]*\}/)?.[0] ?? "";
  assert.match(block, /min-height:\s*44px/);
  // And the workspace actually carries the scoping class the rule keys on.
  assert.match(read("src/modules/inventory/Receiving.jsx"), /className="fo-receiving-workspace"/);
});

test("FRAME 1f PIN: no handheld rule hides a truth state or the review/consequence stage", () => {
  // Every ≤640px media block in the stylesheet: nothing inside it may display:none an error,
  // warning, status message, confirm read-back, or the queue's disclosure copy.
  const s = css();
  const mobileBlocks = [...s.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(mobileBlocks.length > 0, "the handheld blocks must exist to be checked");
  for (const block of mobileBlocks) {
    for (const guarded of ["fo-warning", "fo-error", "fo-inline-error", "fo-receive-confirm", "fo-confirm-readback", "data-locations-message", "fo-receiving-queue__note"]) {
      const rules = block.match(new RegExp(`[^{}]*${guarded}[^{}]*\\{[^}]*\\}`, "g")) ?? [];
      for (const rule of rules) {
        assert.doesNotMatch(rule, /display:\s*none/, `a phone rule must not hide ${guarded}`);
      }
    }
  }
});

test("the workspace states the RCV-G1 receipt-history slot honestly and renders no receiving_orders read", () => {
  const src = read("src/modules/inventory/Receiving.jsx");
  assert.match(src, /Not connected yet/);
  // No direct Firestore read appears in the workspace — its reads are the existing hooks and the
  // governed callable client, so a list against the deny-all collection cannot be built here.
  assert.doesNotMatch(src, /firebase\/firestore|getDocs|onSnapshot/);
});
