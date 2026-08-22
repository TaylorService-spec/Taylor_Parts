#!/usr/bin/env node
// EFFECTIVE AUTHORITY. What a Role can actually DO -- not what it has been granted.
//
// GRANT != ACTIVATION. 44 of the 116 catalog ids are registered active:false and resolve DENY with
// reason `inactivePermission` no matter who holds them. A report that lists grants and calls it
// authority overstates every Role in the system, and it overstates them differently, because the
// inactive ids are not spread evenly.
//
// So every Role is reported twice: GRANTED (what the role definition says) and OPERABLE (what
// survives the catalog's own active flag today). The gap between the two columns is the honest
// answer to "can this employee do their job", and it is the number a grant plan needs.
//
// Run: node scripts/governance/effectiveAuthority.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { PERMISSION_CATALOG } = await import(L("functions/lib/access/permissionCatalog.js"));
const { GOVERNED_BUSINESS_ROLES: GB } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { COMPATIBILITY_ROLES: CR } = await import(L("functions/lib/access/compatibilityRoles.js"));
const { composedFor } = await import(pathToFileURL(path.resolve(__dirname, "functionalRoleComposition.mjs")).href);

const ALL = { ...CR, ...GB };
const ACTIVE = new Set(PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id));
const IDS = PERMISSION_CATALOG.map((p) => p.id);
const PRIVILEGED = new Set(Object.values(ALL).filter((r) => r.privileged || r.id === "owner" || r.id === "admin").map((r) => r.id));

// EFFECTIVE AUTHORITY, per Role.
const roles = [];
for (const r of Object.values(GB)) {
  const composed = composedFor(r.id);
  const viaComposed = [...new Set(composed.flatMap((f) => GB[f]?.permissions || []))];
  const granted = [...new Set([...(r.permissions || []), ...viaComposed])].sort();
  const operable = granted.filter((id) => ACTIVE.has(id));
  const blocked = granted.filter((id) => !ACTIVE.has(id));
  roles.push({
    roleId: r.id, label: r.name || r.id, composedFunctionalRoles: composed,
    grantedCount: granted.length, operableCount: operable.length, blockedCount: blocked.length,
    granted, operableNow: operable, grantedButInactive: blocked,
  });
}
roles.sort((a, b) => b.grantedCount - a.grantedCount);

// OWNER/ADMIN-ONLY BREAKDOWN. The Owner asked for these separated, because they are not one thing.
//
//   DELIBERATELY_PRIVILEGED_ONLY -- a decision put it here and it stays here.
//   UNASSIGNED_UNRESOLVED        -- nobody has decided; it sits with the privileged Roles because
//                                   admin holds the whole catalog by derivation, not because
//                                   anyone chose that. Reporting is 39 of these.
//
// Collapsing the two would report an undecided question as a settled policy.
const heldBy = {};
for (const r of Object.values(ALL)) for (const p of r.permissions || []) (heldBy[p] ??= []).push(r.id);
const privilegedOnly = IDS.filter((id) => heldBy[id]?.length && heldBy[id].every((x) => PRIVILEGED.has(x)));

// Owner decisions 2026-08-21 resolved most of what used to sit here undecided. Three RECORDED GAPS
// remain, and each carries the code the Owner asked for -- a gap with a name is a decision to
// revisit it, an unnamed one is just an absence nobody is accountable for.
const DELIBERATE = {
  "admin.": "Owner decision 2026-08-21 (General Manager Option 2): capability and role administration stays with Owner/Admin. The highest BUSINESS role is not security administration, and two-person control over privilege is preserved.",
  "report.definition.delete": "Owner decision 2026-08-21: authoring a saved report definition is delegable to reportAuthor; DESTROYING one is not. A delete removes something other people depend on and there is no per-definition ownership model to scope it.",
};

// GAP CODES. Each is a capability nobody holds because a decision deliberately deferred it, not
// because it was overlooked.
const GAP = {
  "coverage.": {
    code: "COVERAGE_TERRITORY_AUTHORITY_GAP",
    why: "Owner decision 2026-08-21: Coverage/Territory is DEFERRED. coverage.* stays unassigned and unactivated, and the architecture seam (own / team / territory / branch-company scope) is preserved for a future decision. Deliberately NOT compensated for with broad business-role reads.",
  },
  "equipment.compatibility.": {
    code: "EQUIPMENT_COMPATIBILITY_ENGINE_DRAFT",
    why: "Owner decision 2026-08-21: the Equipment Compatibility engine (D4) is still a draft. equipmentCatalogAdministrator exists and holds equipment.model.manage only -- draft authority is NOT activated merely because a Role now exists that could hold it.",
  },
  "report.customer.field.notes.": {
    code: "REPORTING_SENSITIVITY_CAPABILITY_GAP",
    why: "Registered active:false and plausibly sensitive, but the catalog has no way to express WHICH sensitivity. Left out of every reporting tier rather than guessed into one: broadening access to complete a model is the failure the tiering exists to prevent.",
  },
  "report.customer.field.accountOwner.": {
    code: "REPORTING_SENSITIVITY_CAPABILITY_GAP",
    why: "Same as customer notes -- inactive, plausibly employee-sensitive, and the catalog cannot distinguish employee-sensitive reporting from ordinary reporting. No id was invented to complete the model.",
  },
  "report.location.field.accessNotes.": {
    code: "REPORTING_SENSITIVITY_CAPABILITY_GAP",
    why: "Site access notes are plausibly security-sensitive and the id is inactive. Excluded from reportViewer rather than assumed harmless.",
  },
};

const classify = (id) => {
  for (const [p, why] of Object.entries(DELIBERATE)) if (id.startsWith(p)) return { status: "DELIBERATELY_PRIVILEGED_ONLY", why };
  for (const [p, g] of Object.entries(GAP)) if (id.startsWith(p)) return { status: "RECORDED_GAP", gapCode: g.code, why: g.why };
  return { status: "UNCLASSIFIED", why: "no recorded decision either way -- surface before PASS" };
};
const breakdown = privilegedOnly.map((id) => ({ capability: id, active: ACTIVE.has(id), ...classify(id) }));

const counts = {};
for (const b of breakdown) counts[b.status] = (counts[b.status] || 0) + 1;
const out = {
  catalog: { total: IDS.length, active: ACTIVE.size, inactive: IDS.length - ACTIVE.size },
  heldByNobody: IDS.filter((id) => !heldBy[id]),
  ownerAdminOnly: { total: privilegedOnly.length, byStatus: counts, capabilities: breakdown },
  roles,
};
writeFileSync(path.join(REPO, "docs/governance/effective-authority.json"), JSON.stringify(out, null, 1));

console.log(`catalog ${IDS.length} | active ${ACTIVE.size} | inactive ${IDS.length - ACTIVE.size} | held by nobody ${out.heldByNobody.length}`);
console.log("\nROLE".padEnd(24), "GRANTED".padStart(8), "OPERABLE".padStart(9), "BLOCKED".padStart(8));
for (const r of roles) console.log(r.roleId.padEnd(24), String(r.grantedCount).padStart(8), String(r.operableCount).padStart(9), String(r.blockedCount).padStart(8));
console.log("\nowner/admin-only:", privilegedOnly.length);
for (const [k, v] of Object.entries(counts)) console.log("  ", k.padEnd(30), v);
const unclassified = breakdown.filter((b) => b.status === "UNCLASSIFIED");
if (unclassified.length) console.log("  UNCLASSIFIED:", unclassified.map((u) => u.capability).join(", "));
