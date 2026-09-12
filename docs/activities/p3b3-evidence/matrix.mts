import { readFileSync, writeFileSync } from "node:fs";
const W = "/home/rudy2/.local/share/eos-worktrees/p3b3-act-sales";
const { resolveEffectivePermission } = await import(W + "/field-ops-app-vite/src/access/resolveEffectivePermission.ts");
const { GOVERNED_BUSINESS_ROLES } = await import(W + "/field-ops-app-vite/src/access/governedBusinessRoles.ts");
const { COMPATIBILITY_ROLES } = await import(W + "/field-ops-app-vite/src/access/compatibilityRoles.ts");
const { PERMISSION_CATALOG } = await import(W + "/field-ops-app-vite/src/access/permissionCatalog.ts");
const roles: any = { ...(GOVERNED_BUSINESS_ROLES as any), ...(COMPATIBILITY_ROLES as any) };
const envs = JSON.parse(readFileSync(W + "/config/environments.json", "utf8"));
const list = envs.environments ?? envs;
const sb = new Set<string>((list as any[]).find((e) => e.id === "platform-sandbox").capabilityActivationOverrides ?? []);
const cert = new Set<string>((list as any[]).find((e) => e.id === "platform-certification").capabilityActivationOverrides ?? []);
const prod = new Set<string>((list as any[]).find((e) => e.id === "taylor-parts-production").capabilityActivationOverrides ?? []);
const target = { condition: {} } as any;
const ask = (roleId: string, cap: string, ov: Set<string>) => resolveEffectivePermission({
  permissionId: cap as any,
  assignments: [{ id: "ra1", principalUid: "p1", roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 }] as any,
  roles, currentAccessVersion: 1, target, activationOverrides: ov as any });
const caps = (PERMISSION_CATALOG as any[]).map((p) => ({ id: p.id, active: p.active }));
const out: any = { roleCount: Object.keys(roles).length, capCount: caps.length, sandboxOverrides: sb.size, certOverrides: cert.size, prodOverrides: prod.size, byCap: {} as any };
for (const c of caps) {
  const prodAllow: string[] = [], sbAllow: string[] = [], holders: string[] = [];
  for (const rid of Object.keys(roles)) {
    if ((roles[rid].permissions ?? []).includes(c.id)) holders.push(rid);
    if (ask(rid, c.id, prod).decision === "ALLOW") prodAllow.push(rid);
    if (ask(rid, c.id, sb).decision === "ALLOW") sbAllow.push(rid);
  }
  out.byCap[c.id] = { active: c.active === false ? false : true, holders, holderCount: holders.length,
    prodAllow, sandboxAllow: sbAllow,
    governedHolders: holders.filter((h) => h !== "admin" && h !== "owner"),
    sandboxActivated: sb.has(c.id) };
}
writeFileSync("/tmp/claude-1000/-home-rudy2/420f8db5-9c22-4692-ab2c-a24bee4416dd/scratchpad/night/p3b3/matrix.json", JSON.stringify(out, null, 1));
const ungranted = caps.filter((c) => out.byCap[c.id].holderCount === 0);
const adminOnly = caps.filter((c) => out.byCap[c.id].governedHolders.length === 0);
const inactiveNoSandbox = caps.filter((c) => out.byCap[c.id].active === false && !sb.has(c.id));
console.log("ROLES", out.roleCount, "CAPS", out.capCount);
console.log("UNGRANTED (zero holders):", ungranted.length, ungranted.map((c) => c.id).join(", ") || "(none)");
console.log("ADMIN/OWNER-ONLY (no governed business role holds it):", adminOnly.length);
for (const c of adminOnly) console.log("   ", c.id, "active=" + out.byCap[c.id].active, "holders=" + out.byCap[c.id].holders.join(","));
console.log("ACTIVE:FALSE AND NOT SANDBOX-ACTIVATED (dead in every environment):", inactiveNoSandbox.length);
for (const c of inactiveNoSandbox) console.log("   ", c.id);
console.log("ALLOWED ANYWHERE IN PRODUCTION:", caps.filter((c)=>out.byCap[c.id].prodAllow.length>0).length);
