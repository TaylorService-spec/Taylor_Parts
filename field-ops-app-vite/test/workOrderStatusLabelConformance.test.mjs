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

check("WorkOrderPreview.jsx (Control Tower dispatcher preview pane): uses workOrderStatusLabel", () => {
  const text = read("modules/dispatcherBoard/WorkOrderPreview.jsx");
  assert.match(text, /import \{ workOrderStatusLabel \} from "\.\.\/\.\.\/domain\/workOrderStatus"/);
  assert.match(text, /\{workOrderStatusLabel\(workOrder\.status\)\}/);
  assert.doesNotMatch(text, /[^(]\{workOrder\.status\}/, "raw {workOrder.status} render survived");
});

check("WorkOrderQueue.jsx: both the status chip and the aria-label use workOrderStatusLabel", () => {
  const text = read("modules/dispatcherBoard/WorkOrderQueue.jsx");
  assert.match(text, /import \{ workOrderStatusLabel \} from "\.\.\/\.\.\/domain\/workOrderStatus"/);
  assert.match(text, /\{workOrderStatusLabel\(wo\.status\)\}/, "status chip text");
  assert.match(text, /status \$\{workOrderStatusLabel\(wo\.status\)\}/, "aria-label sentence");
  assert.doesNotMatch(text, /status \$\{wo\.status\}/, "aria-label still reads the raw enum");
});

check("DispatcherBoard.jsx: status-filter dropdown options render workOrderStatusLabel, not the bare enum", () => {
  const text = read("modules/dispatcherBoard/DispatcherBoard.jsx");
  assert.match(text, /import \{ WORK_ORDER_STATUS_VALUES, workOrderStatusLabel \} from "\.\.\/\.\.\/domain\/workOrderStatus"/);
  assert.match(text, /WORK_ORDER_STATUS_VALUES\.map/, "dropdown built from the canonical value list, not a hand-copied array");
  assert.match(text, /<option key=\{s\} value=\{s\}>\s*\{workOrderStatusLabel\(s\)\}/);
});

check("TechnicianBoard.jsx: the 'is <status> --' sentence uses workOrderStatusLabel", () => {
  const text = read("modules/dispatcherBoard/TechnicianBoard.jsx");
  assert.match(text, /import \{ workOrderStatusLabel \} from "\.\.\/\.\.\/domain\/workOrderStatus"/);
  assert.match(text, /is \{workOrderStatusLabel\(selectedWorkOrder\.status\)\}/);
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
  "modules/technicianDashboard/TechnicianWorkOrderCard.jsx",
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
    "modules/dispatcherBoard/WorkOrderQueue.jsx",
    "modules/dispatcherBoard/TechnicianBoard.jsx",
  ];
  const stillFlagged = fixed.filter((r) => findRawWorkOrderStatusRenders().has(r));
  assert.deepEqual(stillFlagged, [], `Fixed file(s) still trigger the raw-status detector:\n${stillFlagged.join("\n")}`);
  const staleAllowlist = fixed.filter((r) => KNOWN_RAW_WO_STATUS_ALLOWLIST.has(r));
  assert.deepEqual(staleAllowlist, [], `Fixed file(s) left on the allowlist -- remove them:\n${staleAllowlist.join("\n")}`);
});

console.log(`${passed} checks passed`);
