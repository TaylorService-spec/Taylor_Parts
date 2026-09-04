// M20 -- "one status, three vocabularies." src/domain/workOrderStatus.js is the canonical
// Work Order status -> label map (its own header explains why: before it existed, each screen
// turned a stored status like WORK_IN_PROGRESS into words privately, so nothing kept two screens
// saying the same thing about the same record). This suite is the regression gate for that fix:
// it asserts the screens named in the M20 defect now route through the canonical map, and it
// scans the wider component tree with a burn-down allowlist (same convention as
// test/compositionConformance.test.jsx's LEGACY_BADGE_ALLOWLIST) so a NEW screen introducing a
// raw status render fails the build instead of shipping silently.
//
// NOT touched here, on purpose: controlTower/WorkOrderActions.jsx's action-framed labels
// ("Active job", "Awaiting technician") are a documented, deliberate divergence (see
// workOrderStatus.js's own header) -- they describe what the action panel is FOR at a stage, not
// a name for the status, and are excluded from every check below.
//
// Run: node test/workOrderStatusLabelConformance.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workOrderStatusLabel, WORK_ORDER_STATUS_VALUES } from "../src/domain/workOrderStatus.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("workOrderStatusLabelConformance.test.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).split(path.sep).join("/");

// --- Part 1: the M20 defect's named sites now route through the canonical map ------------------

// The M20 route CHANGED here, and this check follows it rather than being relaxed.
//
// WorkOrdersList.jsx no longer renders a status cell of its own: the list moved onto the metadata
// runtime, so MetadataListGrid renders the Status column from the field definition's `enumLabels`.
// The canonical map is still the only vocabulary in play -- it simply arrives through
// metadata/definitions/workOrder.js instead of an import in the screen. What must stay true is
// that the labels come from workOrderStatus.js and that nothing renders the bare enum, so that is
// what is asserted, at the place the rendering now happens.
check("WorkOrdersList.jsx: status is rendered from the metadata enum labels, never the raw enum", () => {
  const text = read("modules/workOrders/WorkOrdersList.jsx");
  assert.doesNotMatch(text, /[^(]\{wo\.status\}/, "raw {wo.status} render survived");
  assert.match(text, /MetadataListGrid/, "status now renders through the metadata grid");

  const def = read("metadata/definitions/workOrder.js");
  assert.match(
    def,
    /import \{ WORK_ORDER_STATUS_LABEL, WORK_ORDER_STATUS_VALUES \} from "\.\.\/\.\.\/domain\/workOrderStatus\.js"/,
    "the definition must take its labels from the canonical map, not restate them",
  );
  assert.match(def, /enumLabels: WORK_ORDER_STATUS_LABEL/);
});

// THE AGGREGATE PATH -- the one a variable-name heuristic could never see.
//
// The repo-wide sweep below keys on WO_ID_NAMES: wo, workOrder, selectedWorkOrder, job. My
// Dashboard's Team performance renders a COUNTS-BY-STATUS aggregate, so its row variable is `r`,
// and `label={r.status}` matched nothing. The screen shipped reading "WORK_IN_PROGRESS" while the
// technician surface -- fixed in #1793 -- read "In Progress" for the same record, and the guard
// that exists to prevent exactly that was structurally blind to it.
//
// Widening WO_ID_NAMES to any identifier was measured and rejected: it flags label={truck.status},
// {tech.status}, {account.status} and {part.status}, which are OTHER governed vocabularies. A Work
// Order guard that fires on a truck is a guard that gets weakened. A named site is the honest fix.
check("MyDashboard.jsx Team performance: the by-status aggregate is labelled, not enumerated", () => {
  const text = read("modules/dashboard/MyDashboard.jsx");
  assert.ok(text.includes(`import { workOrderStatusLabel } from "../../domain/workOrderStatus.js"`), "the canonical helper import is gone");
  assert.ok(text.includes("label={workOrderStatusLabel(r.status)}"), "the aggregate must go through the helper");
  assert.ok(!text.includes("label={r.status}"), "the raw aggregate status render is back");
  // The KEY may stay the machine value -- it is an identity, not prose.
  assert.ok(text.includes("key={r.status}"), "the machine value is the stable key and should stay");
});

// BEHAVIOURAL, not a grep: every value the enum can actually hold must have words. A vocabulary
// with a gap would let a real status render as its own token even through the helper, because
// workOrderStatusLabel returns an unrecognised value VERBATIM by design.
check("every stored Work Order status has a human label -- no value renders as its own token", () => {
  for (const value of WORK_ORDER_STATUS_VALUES) {
    const label = workOrderStatusLabel(value);
    assert.notEqual(label, value, `${value} has no label and would render as the stored token`);
    assert.doesNotMatch(label, /^[A-Z][A-Z0-9_]*$/, `${value} -> "${label}" still reads as an enum`);
    assert.doesNotMatch(label, /_/, `${value} -> "${label}" still contains an underscore`);
  }
  assert.ok(WORK_ORDER_STATUS_VALUES.length >= 8, "the vocabulary shrank -- is this list still the real enum?");
  // The two the Owner actually saw leak, named so a regression is unmistakable.
  assert.equal(workOrderStatusLabel("WORK_IN_PROGRESS"), "In Progress");
  assert.equal(workOrderStatusLabel("EN_ROUTE"), "En Route");
});

check("WorkOrderPreview.jsx (Control Tower dispatcher preview pane): uses workOrderStatusLabel", () => {
  const text = read("modules/dispatcherBoard/WorkOrderPreview.jsx");
  assert.match(text, /import \{ workOrderStatusLabel \} from "\.\.\/\.\.\/domain\/workOrderStatus"/);
  assert.match(text, /\{workOrderStatusLabel\(workOrder\.status\)\}/);
  assert.doesNotMatch(text, /[^(]\{workOrder\.status\}/, "raw {workOrder.status} render survived");
});

// ── Dispatch North Star P1 (2026-08-27) ──────────────────────────────────────────────────────────
//
// Three checks used to live here, against WorkOrderQueue.jsx, TechnicianBoard.jsx and the board's
// status-filter dropdown. All three surfaces were REPLACED by the North Star composition: the queue
// became ReadyToScheduleQueue, the technician columns became the lane grid, and the status filter
// became the Day/Week/2-week view switcher.
//
// The RULE they defended is unchanged and is re-asserted below against what replaced them. Deleting
// them without a replacement would have quietly reduced this gate's coverage at exactly the moment a
// surface was rewritten — which is when a raw enum is most likely to reappear.

check("ReadyToScheduleQueue.jsx: no raw Work Order status enum reaches the card", () => {
  // It renders no status CHIP at all now, because every card in this queue is READY_TO_DISPATCH and
  // a column repeating one word on every row is noise. So the assertion is the ABSENCE of the enum
  // rather than the presence of the label.
  const text = read("modules/dispatcherBoard/ReadyToScheduleQueue.jsx");
  assert.doesNotMatch(text, /\{wo\.status\}/, "raw {wo.status} render");
  assert.doesNotMatch(text, /status \$\{wo\.status\}/, "raw enum in a sentence");
});

check("DispatcherBoard.jsx: a refusal names the status through workOrderStatusLabel", () => {
  // The board tells a dispatcher why a chip cannot move — "it is Dispatched". That sentence must use
  // the governed label: a locally humanised enum is a SECOND status vocabulary, it drifts the moment
  // a label is reworded, and it puts the raw value on screen for anything the local transform does
  // not recognise.
  const text = read("modules/dispatcherBoard/DispatcherBoard.jsx");
  assert.match(text, /import \{ workOrderStatusLabel \} from "\.\.\/\.\.\/domain\/workOrderStatus"/);
  assert.match(text, /workOrderStatusLabel\(status\)/, "the governed label");
  assert.doesNotMatch(text, /toLowerCase\(\)\.replace\(\/_\/g/, "a hand-rolled status humaniser");
});

check("DispatchLaneGrid.jsx: a lane chip carries no raw status enum", () => {
  const text = read("modules/dispatcherBoard/DispatchLaneGrid.jsx");
  assert.doesNotMatch(text, /\{wo\.status\}/, "raw {wo.status} render");
});

check("DispatchSchedulingWorkspace.jsx: technician status text is unified on dispatcherBoard/technicianStatusLabel", () => {
  const text = read("modules/dispatch/DispatchSchedulingWorkspace.jsx");
  assert.match(text, /import \{ technicianStatusLabel \} from "\.\.\/dispatcherBoard\/technicianStatusLabel"/);
  assert.match(text, /label=\{technicianStatusLabel\(tech\.status\)\}/);
  // The board used to hand-write its own "On job" / "Off shift" strings, diverging from
  // technicianStatusLabel's "Busy" / "Off Shift" for the identical TECH_STATUS values. Both
  // literal strings must be gone -- their presence means the ternary crept back in.
  assert.doesNotMatch(text, /"On job"/);
  assert.doesNotMatch(text, /"Off shift"/);
});

// --- Part 2: burn-down gate -- no NEW raw Work Order status render anywhere in modules/shared ---
//
// Three shapes of the same bug, all scoped to Work Order status specifically (equipment/part/PO/
// truck status etc. are a different vocabulary, out of scope for M20, not flagged here):
//   JSXCHILD  -- a JSX text child that is just the raw field, e.g. `>{wo.status}<`
//   TEMPLATE  -- a template-literal sentence that interpolates the raw field, e.g. `${wo.status}`
//   LABELPROP -- StatusPill's `label` prop set straight to the raw field, e.g. `label={wo.status}`
// A variable is treated as "a Work Order" by name only (wo / workOrder / selectedWorkOrder / job)
// -- the same identifiers the M20 report and this codebase's Work Order screens already use.
const WO_ID_NAMES = "(wo|workOrder|selectedWorkOrder|job)";
const JSXCHILD_RE = new RegExp(`[^=\`$]\\{\\s*${WO_ID_NAMES}\\.status\\s*\\}`, "g");
const TEMPLATE_RE = new RegExp(`\\$\\{\\s*${WO_ID_NAMES}\\.status\\s*\\}`, "g");
const LABELPROP_RE = new RegExp(`label=\\{\\s*${WO_ID_NAMES}\\.status(\\s*\\|\\|[^}]*)?\\}`, "g");

// Pre-existing raw renders OUTSIDE the M20 report's named sites. Not this fix's scope -- reported
// separately, not silently fixed here. This list may only SHRINK as each is migrated; it must
// never grow (that's the regression gate: a new offender not on this list fails GATE below).
const KNOWN_RAW_WO_STATUS_ALLOWLIST = new Set([
  "modules/accounts/ServiceActivitySection.jsx",
  "modules/controlTower/WorkOrderDetail.jsx",
  "modules/dispatcherBoard/DispatcherBoard.jsx", // handleDispatchDrop's error sentence, NOT the (now-fixed) filter dropdown
  "modules/jobs/Jobs.jsx",
  "modules/scheduling/SchedulingWorkspace.jsx",
  "modules/service/CoordinatedVisitsWorkspace.jsx",
]);

function findRawWorkOrderStatusRenders() {
  const files = [...walk(path.join(SRC, "modules")), ...walk(path.join(SRC, "shared"))];
  const offenders = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (JSXCHILD_RE.test(text) || TEMPLATE_RE.test(text) || LABELPROP_RE.test(text)) {
      offenders.add(rel(f));
    }
    JSXCHILD_RE.lastIndex = 0;
    TEMPLATE_RE.lastIndex = 0;
    LABELPROP_RE.lastIndex = 0;
  }
  return offenders;
}

check("GATE -- no new raw Work Order status render outside the known allowlist", () => {
  const offenders = [...findRawWorkOrderStatusRenders()].filter((r) => !KNOWN_RAW_WO_STATUS_ALLOWLIST.has(r));
  assert.deepEqual(
    offenders,
    [],
    `New raw Work Order status render(s) -- route through workOrderStatusLabel():\n${offenders.join("\n")}`
  );
});

check("GATE -- the M20-fixed sites are actually off the allowlist (burn-down proof)", () => {
  const fixed = [
    "modules/workOrders/WorkOrdersList.jsx",
    "modules/dispatcherBoard/WorkOrderPreview.jsx",
    // WorkOrderQueue.jsx and TechnicianBoard.jsx were DELETED by the Dispatch North Star P1
    // composition, not un-fixed. Their successors carry the burn-down instead: a file that no longer
    // exists cannot be proved off an allowlist, and leaving the names here would fail the read.
    "modules/dispatcherBoard/ReadyToScheduleQueue.jsx",
    "modules/dispatcherBoard/DispatchLaneGrid.jsx",
  ];
  const stillFlagged = fixed.filter((r) => findRawWorkOrderStatusRenders().has(r));
  assert.deepEqual(stillFlagged, [], `Fixed file(s) still trigger the raw-status detector:\n${stillFlagged.join("\n")}`);
  const staleAllowlist = fixed.filter((r) => KNOWN_RAW_WO_STATUS_ALLOWLIST.has(r));
  assert.deepEqual(staleAllowlist, [], `Fixed file(s) left on the allowlist -- remove them:\n${staleAllowlist.join("\n")}`);
});

console.log(`${passed} checks passed`);
