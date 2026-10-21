// UAT census -- static extraction from the repository at the working-tree commit. READ-ONLY: it parses source text and imports one
// pure client module (navConfig.js). It runs no test, opens no database and touches no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FN = (p) => path.join(REPO_ROOT, "functions", "src", p);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const read = (p) => strip(fs.readFileSync(FN(p), "utf8"));

function matchBlock(src, startIdx, open) {
  const close = open === "{" ? "}" : open === "[" ? "]" : ")";
  let depth = 0, j = startIdx;
  for (; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (depth === 0) break; }
  }
  return src.slice(startIdx, j + 1);
}
function constBlock(src, name) {
  const m = new RegExp("(?:export\\s+)?const\\s+" + name + "\\b[^=]*=\\s*", "m").exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < src.length && !"{[".includes(src[i])) i++;
  return matchBlock(src, i, src[i]);
}
const arrayStrings = (b) => [...b.matchAll(/"([A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
function objectKeys(b) {
  const keys = []; let depth = 0, cur = "";
  const body = b.slice(1, -1);
  for (const c of body) {
    if ("{[(".includes(c)) depth++; else if ("}])".includes(c)) depth--;
    if (depth === 0 && c === ",") { keys.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim()) keys.push(cur);
  return keys.map((k) => /^\s*(?:"([^"]+)"|([A-Za-z0-9_$]+))/.exec(k)).filter(Boolean).map((m) => m[1] || m[2]);
}

// [registry id, API route, source file under functions/src, constant, kind]
const REGISTRIES = [
  ["ops.read", "/operations/inventory", "eosOps/eosOpsHttp.ts", "OPERATIONS_READ_OPERATIONS", "array"],
  ["ops.mutation", "/operations/inventory", "eosOps/eosOpsHttp.ts", "OPERATIONS_MUTATION_OPERATIONS", "array"],
  ["cycleCount", "/operations/cycle-count", "eosOps/cycleCountOperations.ts", "EOS_CYCLE_COUNT_OPERATIONS", "object"],
  ["relocation", "/operations/relocation", "eosOps/stockRelocationOperations.ts", "EOS_RELOCATION_OPERATIONS", "object"],
  ["transfer", "/operations/transfer", "eosOps/transferOperations.ts", "EOS_TRANSFER_OPERATIONS", "object"],
  ["placement", "/operations/placement", "eosOps/binPlacementOperations.ts", "EOS_PLACEMENT_OPERATIONS", "object"],
  ["serializedAsset", "/operations/serialized-asset", "eosOps/serializedAssetAcquireOperations.ts", "EOS_ACQUIRE_OPERATIONS", "object"],
  ["workOrder", "/operations/work-orders", "eosOps/workOrderOperations.ts", "EOS_WORK_ORDER_OPERATIONS", "object"],
  ["workOrder.read", "/operations/work-orders", "eosOps/workOrderOperations.ts", "WORK_ORDER_READ_OPERATIONS", "array"],
  ["inboundWork", "/operations/inbound-work", "eosOps/inboundWorkOperations.ts", "EOS_INBOUND_WORK_OPERATIONS", "object"],
  ["inboundWork.read", "/operations/inbound-work", "eosOps/inboundWorkOperations.ts", "INBOUND_WORK_READ_OPERATIONS", "array"],
  ["inboundRecovery", "/operations/inbound-work", "eosOps/inboundWorkRecovery.ts", "INBOUND_RECOVERY_OPERATIONS", "object"],
  ["inboundProvider", "/operations/inbound-work", "eosOps/inboundProviderRuntime.ts", "INBOUND_PROVIDER_OPERATIONS", "object"],
  ["equipment", "/operations/equipment", "eosOps/equipmentOperations.ts", "EOS_EQUIPMENT_OPERATIONS", "object"],
  ["finance", "/operations/finance", "eosFinance/financeOperations.ts", "EOS_FINANCE_OPERATIONS", "object"],
  ["financialPolicy", "/operations/finance", "eosFinance/financialPolicy.ts", "EOS_FINANCIAL_POLICY_OPERATIONS", "object"],
  ["financeConfig", "/operations/finance", "eosFinance/financeConfigurationAdministration.ts", "FINANCE_CONFIGURATION_OPERATIONS", "array"],
  ["rental", "/operations/rental", "eosRental/rentalOperations.ts", "EOS_RENTAL_OPERATIONS", "object"],
  ["analysis", "/operations/analysis", "eosAnalysis/analysisOperations.ts", "EOS_ANALYSIS_OPERATIONS", "object"],
  ["workspace", "/operations/workspace", "eosExperience/workspaceOperations.ts", "EOS_WORKSPACE_OPERATIONS", "object"],
  ["workflowRuntime", "/operations/workflow", "eosOps/workflowRuntimeOperations.ts", "EOS_WORKFLOW_RUNTIME_OPERATIONS", "object"],
  ["salesOrderAllocation", "/operations/inventory", "eosOps/salesOrderAllocation.ts", "EOS_SALES_ORDER_ALLOCATION_OPERATIONS", "object"],
  ["catalog.read", "/operations/catalog", "catalogMaster/catalogHttp.ts", "CATALOG_READ_OPERATIONS", "array"],
  ["catalog.mutation", "/operations/catalog", "catalogMaster/catalogHttp.ts", "CATALOG_MUTATION_OPERATIONS", "array"],
  ["commercial.read", "/commercial", "eosCommercial/commercialHttp.ts", "READ_RUNNERS", "object"],
  ["commercial.mutation", "/commercial", "eosCommercial/commercialHttp.ts", "MUTATION_RUNNERS", "object"],
  ["crm", "/crm", "eosCrm/crmHttp.ts", "RUNNERS", "object"],
  ["workforce.read", "/workforce", "eosWorkforce/workforceHttp.ts", "READ_RUNNERS", "object"],
  ["workforce.command", "/workforce", "eosWorkforce/workforceHttp.ts", "COMMAND_RUNNERS", "object"],
  ["admin.read", "/admin/policy", "adminPolicy/adminPolicyApi.ts", "ADMIN_READ_OPERATIONS", "array"],
  ["admin.mutation", "/admin/policy", "adminPolicy/adminPolicyApi.ts", "ADMIN_MUTATION_OPERATIONS", "array"],
  ["admin.preview", "/admin/policy", "adminPolicy/adminPolicyApi.ts", "ADMIN_PREVIEW_OPERATIONS", "array"],
  ["workflowAdmin.read", "/admin/policy", "adminPolicy/workflowAdminApi.ts", "WORKFLOW_READ_OPERATIONS", "array"],
  ["workflowAdmin.mutation", "/admin/policy", "adminPolicy/workflowAdminApi.ts", "WORKFLOW_MUTATION_OPERATIONS", "array"],
  ["adminConfig", "/admin/policy", "adminPolicy/configurationOperations.ts", "ADMIN_CONFIGURATION_OPERATIONS", "object"],
  ["systemConfiguration", "/admin/policy", "eosOps/systemConfigurationAdministration.ts", "SYSTEM_CONFIGURATION_OPERATIONS", "array"],
  ["truckRegistryAdmin", "/admin/policy", "eosOps/truckRegistryAdministration.ts", "TRUCK_REGISTRY_ADMIN_OPERATIONS", "array"],
  ["warehouseAdmin", "/admin/policy", "eosOps/warehouseBinAdministration.ts", "WAREHOUSE_ADMIN_OPERATIONS", "array"],
  ["salesDiscount", "/admin/policy", "salesAuthority/salesDiscountAuthority.ts", "SALES_DISCOUNT_AUTHORITY_OPERATIONS", "array"],
  ["loginAdmin", "/admin/policy", "eosAuth/eosLoginService.ts", "LOGIN_ADMINISTRATION_OPERATIONS", "object"],
  ["selfScheduling", "/public/self-scheduling", "eosOps/selfScheduling.ts", "SELF_SCHEDULING_WORK_ORDER_OPERATIONS", "object"],
];

/** Every closed operation registry, de-duplicated on (route, operation). The same operation name can be listed by two registries. */
export function extractOperations() {
  const seen = new Map();
  const errors = [];
  for (const [id, route, file, name, kind] of REGISTRIES) {
    let src;
    try { src = read(file); } catch { errors.push({ id, file, error: "file not found" }); continue; }
    const b = constBlock(src, name);
    if (!b) { errors.push({ id, file, error: "constant not found" }); continue; }
    const ops = kind === "array" ? arrayStrings(b) : objectKeys(b);
    for (const op of ops) {
      const key = route + "|" + op;
      if (!seen.has(key)) seen.set(key, { route, op, registries: [] });
      seen.get(key).registries.push(id);
    }
  }
  return { operations: [...seen.values()], errors };
}

/** Parse EXPERIENCE_SURFACES from experienceAuthority.ts (the surface catalog is data written as calls). */
export function extractSurfaces() {
  const src = read("eosOps/experienceAuthority.ts");
  const start = src.indexOf("export const EXPERIENCE_SURFACES");
  const end = src.indexOf("export type ExperienceSurfaceGapKind");
  const body = src.slice(start, end);
  const out = [];
  const re = /\b(surface|container)\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*\[/g;
  let m;
  while ((m = re.exec(body))) {
    const kind = m[1];
    const arrStart = m.index + m[0].length - 1;
    const arr = matchBlock(body, arrStart, "[");
    if (kind === "container") {
      out.push({ key: m[2], label: m[3], container: true, children: arrayStrings(arr), paths: [] });
      continue;
    }
    const paths = [];
    for (const om of arr.matchAll(/\{[^{}]*?(?:\{[^{}]*\}[^{}]*?)*\}/g)) {
      const o = om[0];
      const cap = /capabilityKey:\s*"([^"]+)"/.exec(o)?.[1];
      if (!cap) continue;
      paths.push({
        capabilityKey: cap,
        eligibility: [...o.matchAll(/WORK_ELIGIBILITY\("([^"]+)"\)/g)].map((x) => x[1]),
        scopes: [...o.matchAll(/OPERATIONAL_SCOPE\("([^"]+)"\)/g)].map((x) => x[1]),
        scopedConsumer: /SALES_CHANNEL_LIST\("([^"]+)"\)/.exec(o) ? { scopeType: "salesChannel", consumer: /SALES_CHANNEL_LIST\("([^"]+)"\)/.exec(o)[1] }
          : /OPERATING_COMPANY_LIST\("([^"]+)"\)/.exec(o) ? { scopeType: "operatingCompany", consumer: /OPERATING_COMPANY_LIST\("([^"]+)"\)/.exec(o)[1] } : null,
      });
    }
    out.push({ key: m[2], label: m[3], container: false, children: [], paths });
  }
  return out;
}

/** The (scopeType, capability) pairs a scoped Security Role assignment can actually be evaluated for, with the operations that consume each. */
export function extractScopeEvaluable() {
  const src = read("adminPolicy/assignmentScopeRuntime.ts");
  const b = constBlock(src, "SCOPE_EVALUABLE_GRANTS");
  const out = [];
  for (const m of b.matchAll(/scopeType:\s*"([A-Za-z]+)"\s*as const,\s*capabilityKey:\s*"([^"]+)",[\s\S]*?consumers:\s*Object\.freeze\(\[([\s\S]*?)\]\)/g)) {
    out.push({ scopeType: m[1], capabilityKey: m[2], consumers: arrayStrings(m[3]) });
  }
  return out;
}

/** Navigation destinations, imported from the pure client module, plus which ones App.jsx gives a real component. */
export async function extractNavigation() {
  const nav = await import(pathToFileURL(path.join(REPO_ROOT, "field-ops-app-vite", "src", "navigation", "navConfig.js")).href);
  const app = fs.readFileSync(path.join(REPO_ROOT, "field-ops-app-vite", "src", "App.jsx"), "utf8");
  const branches = new Set([...app.matchAll(/domain\.key === "([A-Za-z]+)" && item\.key === "([A-Za-z]+)"/g)].map((m) => `${m[1]}/${m[2]}`));
  const rows = [];
  for (const d of nav.NAV_DOMAINS) {
    for (const s of d.subnav) {
      const k = `${d.key}/${s.key}`;
      rows.push({
        destination: k, domain: d.key, domainLabel: d.label, key: s.key, label: s.label,
        path: `/${d.path}${s.path ? "/" + s.path : ""}`,
        navHidden: s.navHidden === true,
        legacyKey: s.legacyKey ?? null,
        surfaceAccess: s.surfaceAccess ?? [],
        capabilityAccess: s.capabilityAccess ?? [],
        operationalRoleAccess: s.operationalRoleAccess ?? [],
        containerScope: s.containerScope ?? null,
        legacyPlaceholder: s.legacyPlaceholder === true,
        hasComponentBranch: branches.has(k) || s.legacyKey != null,
      });
    }
  }
  return { rows, domains: nav.NAV_DOMAINS.map((d) => ({ key: d.key, label: d.label, path: d.path, items: d.subnav.length })) };
}

export function readRepoJson(rel) { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")); }
