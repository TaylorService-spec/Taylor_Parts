import { readFileSync } from "node:fs";
const W = "/home/rudy2/.local/share/eos-worktrees/p3b3-act-sales";
const { resolveEffectivePermission } = await import(W + "/field-ops-app-vite/src/access/resolveEffectivePermission.ts");
const { GOVERNED_BUSINESS_ROLES } = await import(W + "/field-ops-app-vite/src/access/governedBusinessRoles.ts");
const { COMPATIBILITY_ROLES } = await import(W + "/field-ops-app-vite/src/access/compatibilityRoles.ts");
const roles: any = { ...(GOVERNED_BUSINESS_ROLES as any), ...(COMPATIBILITY_ROLES as any) };
const envs = JSON.parse(readFileSync(W + "/config/environments.json", "utf8"));
const list = envs.environments ?? envs;
const sandbox = (list as any[]).find((e) => e.id === "platform-sandbox");
const prod = (list as any[]).find((e) => e.id === "taylor-parts-production");
const sbSet = new Set<string>(sandbox.capabilityActivationOverrides ?? []);
const prodSet = new Set<string>(prod.capabilityActivationOverrides ?? []);
console.log("ROLE_COUNT", Object.keys(roles).length);
console.log("SANDBOX_OVERRIDE_COUNT", sbSet.size, "PROD_OVERRIDE_COUNT", prodSet.size);

const mk = (roleId: string) => [{ id: "ra1", principalUid: "p1", roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 }];
const target = { condition: {} } as any;
function ask(roleId: string, cap: string, overrides?: Set<string>) {
  return resolveEffectivePermission({ permissionId: cap as any, assignments: mk(roleId) as any, roles, currentAccessVersion: 1, target, activationOverrides: overrides as any });
}
const CASES: [string, string][] = [
  ["salesperson", "opportunity.write"], ["salesperson", "opportunity.createSalesOrder"],
  ["salesperson", "salesOrder.write"], ["salesperson", "salesAgreement.accept"],
  ["salesperson", "finance.invoice.issue"], ["salesperson", "finance.payment.apply"],
  ["salesperson", "finance.refund.record"], ["salesperson", "finance.visibility.self"],
  ["salesperson", "customer.record.create"], ["salesperson", "customer.governedField.write"],
  ["accountingManager", "finance.invoice.issue"], ["accountingManager", "finance.visibility.consolidated"],
  ["financeManager", "finance.read"], ["controller", "finance.adjustment.record"],
  ["salesManager", "finance.visibility.team"], ["salesManager", "opportunity.write"],
  ["officeManager", "finance.invoice.issue"], ["officeManager", "customer.record.create"],
  ["reportViewer", "report.customer.read"], ["reportFinanceViewer", "report.customer.field.paymentTerms.read"],
  ["reportAuthor", "report.definition.delete"], ["reportAuthor", "report.definition.create"],
  ["admin", "report.definition.delete"], ["admin", "coverage.write"], ["admin", "coverage.read"],
  ["admin", "admin.dataImport.stage"], ["admin", "admin.dataImport.execute"],
  ["admin", "financialPolicy.profile.configure"], ["admin", "finance.visibility.company"],
  ["admin", "finance.visibility.businessUnit"], ["admin", "inventory.catalog.manage"],
  ["admin", "inventory.catalog.activate"], ["admin", "inventory.catalog.alias.read"],
  ["admin", "inventory.balance.read"], ["admin", "inventory.returns.intake"],
  ["admin", "report.customer.field.accountOwner.read"], ["admin", "report.customer.field.notes.read"],
  ["admin", "salesOrder.fulfill"], ["admin", "salesOrder.service"],
  ["salesperson", "salesOrder.fulfill"], ["salesperson", "salesOrder.service"],
  ["generalManager", "salesOrder.fulfill"], ["operationsManager", "salesOrder.fulfill"],
  ["admin", "crm.activity.create"], ["crmActivityContributor", "crm.activity.read"],
  ["admin", "admin.roleAssignment.write"], ["admin", "admin.userStatus.write"],
  ["admin", "audit.event.read"], ["owner", "finance.invoice.issue"],
  ["dispatcher", "finance.invoice.issue"], ["dispatcher", "customer.record.create"],
  ["technician", "customer.record.read"],
];
const rows: any[] = [];
for (const [r, c] of CASES) {
  if (!roles[r]) { rows.push({ role: r, cap: c, prod: "ROLE_NOT_FOUND", sandbox: "ROLE_NOT_FOUND" }); continue; }
  const p = ask(r, c, prodSet);
  const s = ask(r, c, sbSet);
  rows.push({ role: r, cap: c, prod: p.decision + "/" + p.reason, sandbox: s.decision + "/" + s.reason });
}
for (const r of rows) console.log([r.role, r.cap, "PROD=" + r.prod, "SANDBOX=" + r.sandbox].join(" | "));
